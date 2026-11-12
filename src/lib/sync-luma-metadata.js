// Explicit maintenance command; never write from a public GET request.
require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { getLumaStoreSupabaseClient } = require("./supabase");
const { fetchFastlane } = require("./luma-metadata");
const { isDeepStrictEqual } = require("node:util");

const TABLES = new Set([
  "store_apps",
  "luma_submissions",
  "store_app_platforms",
]);
const defaultMetadata = (repo, version) =>
  fetchFastlane(repo, version, fetch, { fresh: true });
const android = (row) => String(row.platform).toLowerCase() === "android";

async function read(client, table, id) {
  const { data, error } = await client
    .from(table)
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) throw error || new Error(`Missing ${table} record`);
  return data;
}
function changes(row, values) {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => !isDeepStrictEqual(row[key], value),
    ),
  );
}
function guard(query, row, fields) {
  for (const field of fields) {
    if (!Object.hasOwn(row, field)) continue;
    if (
      row[field] != null &&
      !["string", "number", "boolean"].includes(typeof row[field])
    )
      continue;
    query =
      row[field] == null ? query.is(field, null) : query.eq(field, row[field]);
  }
  return query;
}
async function write(client, table, row, patch) {
  // Best-effort snapshot check keeps JSON and large metadata out of filter URLs.
  // A concurrent edit after this read can still race the write unless it changes
  // a scalar revision guard; strong atomicity requires a database transaction/RPC.
  if (!isDeepStrictEqual(await read(client, table, row.id), row))
    throw new Error(`${table} changed concurrently; stale snapshot`);
  let query = client.from(table).update(patch).eq("id", row.id);
  query = guard(
    query,
    row,
    new Set([
      "updated_at",
      "status_updated_at",
      "status",
      "archived_at",
      "version",
      "version_code",
      "version_name",
      "repo_url",
      "source_code_url",
      "link",
      "download_url",
      "app_id",
      "platform",
      "developer_id",
      "user_id",
      "author_id",
      "separate_platform_repos",
    ]),
  );
  const { data, error } = await query.select("id").single();
  if (error || !data)
    throw error || new Error(`${table} write denied or stale`);
}
function complete(metadata) {
  const listingComplete = (entry) =>
    entry &&
    [
      "title",
      "shortDescription",
      "fullDescription",
      "changelog",
      "locale",
    ].every((key) => typeof entry[key] === "string" && entry[key].trim()) &&
    Array.isArray(entry.screenshots) &&
    entry.screenshots.length > 0 &&
    entry.screenshots.every((url) => typeof url === "string" && url.length);
  if (
    !listingComplete(metadata) ||
    !Array.isArray(metadata.localized_metadata) ||
    !metadata.localized_metadata.length ||
    !metadata.localized_metadata.every(listingComplete)
  )
    throw new Error(
      "Fastlane metadata unavailable or incomplete; nothing written",
    );
}

async function syncRecord(
  client,
  table,
  id,
  { apply = true, fetchMetadata = defaultMetadata } = {},
) {
  if (!TABLES.has(table)) throw new Error("Unsupported metadata table");
  let row = await read(client, table, id);
  if (table === "store_app_platforms") {
    return syncRecord(client, "store_apps", row.app_id, {
      apply,
      fetchMetadata,
    });
  }
  const result = { table, id, changed: false, locales: [] };
  if (
    (table === "luma_submissions" &&
      ["draft", "archived"].includes(String(row.status).toLowerCase())) ||
    row.archived_at
  )
    return { ...result, skipped: "inactive" };
  let platforms;
  if (table === "store_apps") {
    const { data, error } = await client
      .from("store_app_platforms")
      .select("*")
      .eq("app_id", id);
    if (error) throw error;
    platforms = data || [];
  } else platforms = Array.isArray(row.platforms) ? row.platforms : [];
  const artifact = platforms.find(android);
  if (!artifact) return { ...result, skipped: "no Android artifact" };
  const repo =
    artifact.repoUrl ||
    artifact.repo_url ||
    row.repo_url ||
    row.source_code_url ||
    row.link;
  const metadata = await fetchMetadata(
    repo,
    artifact.versionCode ?? artifact.version_code ?? row.version_code,
  );
  complete(metadata);
  result.locales = metadata.localized_metadata.map((entry) => entry.locale);
  const values = {
    name: metadata.title,
    short_description: metadata.shortDescription,
    description: metadata.fullDescription,
    changelog: metadata.changelog,
    screenshots: metadata.screenshots,
    localized_metadata: metadata.localized_metadata,
    ...(metadata.icon ? { icon_url: metadata.icon } : {}),
  };
  let listingPatch = {};
  if (table === "store_apps") {
    if (row.developer_id) {
      const { data, error } = await client
        .from("luma_developer_profiles")
        .select("display_name")
        .eq("developer_id", row.developer_id)
        .maybeSingle();
      if (error) throw error;
      if (data?.display_name?.trim())
        values.developer_name = data.display_name.trim();
    }
    listingPatch = changes(artifact, {
      listing_metadata: { ...artifact.listing_metadata, ...metadata },
    });
  } else {
    values.platforms = platforms.map((entry) =>
      entry === artifact
        ? { ...entry, metadata: { ...entry.metadata, ...metadata } }
        : entry,
    );
  }
  const patch = changes(row, values);
  result.changed = Boolean(
    Object.keys(patch).length || Object.keys(listingPatch).length,
  );
  if (!apply || !result.changed) return result;
  // PostgREST cannot transact these two writes. Propagate any partial failure so
  // the caller retries; never claim that a partial published sync succeeded.
  if (Object.keys(patch).length) await write(client, table, row, patch);
  if (Object.keys(listingPatch).length) {
    // Even a listing-only refresh must check the app revision before writing.
    const current = await read(client, table, id);
    const expected = { ...row, ...patch };
    // A database trigger may advance updated_at after our own app write.
    if (Object.keys(patch).length) delete expected.updated_at;
    if (
      Object.keys(expected).some(
        (key) => !isDeepStrictEqual(current[key], expected[key]),
      )
    )
      throw new Error("App changed concurrently");
    await write(client, "store_app_platforms", artifact, listingPatch);
  }
  return result;
}

async function main(args = process.argv.slice(2), dependencies = {}) {
  if (args.some((arg) => arg !== "--apply"))
    throw new Error("Usage: node src/lib/sync-luma-metadata.js [--apply]");
  const apply = args.includes("--apply");
  const key = process.env.LUMASTORE_SUPABASE_SERVICE_ROLE_KEY;
  if (apply && !key)
    throw new Error(
      "LUMASTORE_SUPABASE_SERVICE_ROLE_KEY is required for --apply (never use the generic project key).",
    );
  const reader = dependencies.reader || getLumaStoreSupabaseClient();
  const client = apply
    ? dependencies.writer ||
      createClient(reader.supabaseUrl, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : reader;
  let failures = 0;
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await reader
      .from("store_apps")
      .select("id")
      .is("archived_at", null)
      .order("id")
      .range(offset, offset + 99);
    if (error) throw error;
    for (const { id } of data) {
      try {
        console.log(
          await syncRecord(client, "store_apps", id, {
            apply,
            ...(dependencies.fetchMetadata
              ? { fetchMetadata: dependencies.fetchMetadata }
              : {}),
          }),
        );
      } catch (error) {
        failures++;
        console.error(`${id}: sync incomplete: ${error.message}`);
      }
    }
    if (data.length < 100) break;
  }
  if (failures)
    throw new Error(`${failures} failure(s); see diagnostics above.`);
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main, syncRecord };
