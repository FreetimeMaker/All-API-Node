const test = require("node:test");
const assert = require("node:assert/strict");
const { syncRecord, main } = require("./sync-luma-metadata");
const locale = {
  locale: "en-US",
  title: "New",
  shortDescription: "Short",
  fullDescription: "Full",
  changelog: "Changes",
  screenshots: ["shot"],
  icon: "icon",
};
const metadata = {
  ...locale,
  localized_metadata: [locale, { ...locale, locale: "de-DE" }],
  branch: "main",
  commitSha: "abc",
};

function database() {
  const tables = {
    store_apps: [
      {
        id: "app",
        developer_id: "dev",
        developer_name: "Old",
        status: "Published",
        version_code: 42,
        updated_at: null,
        archived_at: null,
        user_id: "owner",
      },
    ],
    store_app_platforms: [
      {
        id: "android",
        app_id: "app",
        platform: "Android",
        repo_url: "repo",
        version_code: 42,
        download_url: "apk",
        listing_metadata: { custom: true },
      },
    ],
    luma_developer_profiles: [
      { developer_id: "dev", display_name: " Canonical " },
    ],
    luma_submissions: [
      {
        id: "sub",
        status: "Pending",
        version_code: 42,
        user_id: "owner",
        link: "fallback",
        platforms: [
          {
            platform: "Android",
            repoUrl: "repo",
            versionCode: 42,
            metadata: { custom: true },
            downloadUrl: "apk",
          },
          { platform: "Web" },
        ],
      },
    ],
  };
  const writes = [];
  const client = {
    tables,
    writes,
    fail: null,
    from(table) {
      const filters = [];
      let patch,
        single = false,
        range;
      const q = {
        select() {
          return q;
        },
        eq(key, value) {
          assert.ok(
            value !== null &&
              ["string", "number", "boolean"].includes(typeof value),
            "eq only accepts scalar guards",
          );
          filters.push([key, value]);
          return q;
        },
        is(key, value) {
          filters.push([key, value]);
          return q;
        },
        single() {
          single = true;
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        update(value) {
          patch = value;
          return q;
        },
        order() {
          return q;
        },
        range(start, end) {
          range = [start, end];
          return q;
        },
        then(resolve, reject) {
          try {
            let rows = tables[table].filter((row) =>
              filters.every(([key, value]) => {
                try {
                  assert.deepEqual(row[key], value);
                  return true;
                } catch {
                  return false;
                }
              }),
            );
            if (patch && client.fail) client.fail(table, tables);
            // Re-evaluate after an injected concurrent change.
            if (patch)
              rows = rows.filter((row) =>
                filters.every(([key, value]) => {
                  try {
                    assert.deepEqual(row[key], value);
                    return true;
                  } catch {
                    return false;
                  }
                }),
              );
            if (single && rows.length !== 1)
              return resolve({
                data: null,
                error: new Error("stale or denied"),
              });
            if (patch) {
              writes.push({ table, patch: structuredClone(patch), filters });
              rows.forEach((row) => Object.assign(row, structuredClone(patch)));
            }
            if (range) rows = rows.slice(range[0], range[1] + 1);
            resolve({
              data: structuredClone(single ? rows[0] : rows),
              error: null,
            });
          } catch (error) {
            reject(error);
          }
        },
      };
      return q;
    },
  };
  return client;
}
const options = { fetchMetadata: async () => structuredClone(metadata) };

test("dry-run and CLI default perform zero writes", async () => {
  const client = database();
  assert.equal(
    (
      await syncRecord(client, "store_apps", "app", {
        ...options,
        apply: false,
      })
    ).changed,
    true,
  );
  await main([], { reader: client, ...options });
  assert.equal(client.writes.length, 0);
});

test("published sync canonicalizes profile, merges locales and is idempotent", async () => {
  const client = database();
  const before = structuredClone(client.tables.store_apps[0]);
  const result = await syncRecord(
    client,
    "store_app_platforms",
    "android",
    options,
  );
  assert.deepEqual(result.locales, ["en-US", "de-DE"]);
  const app = client.tables.store_apps[0];
  assert.equal(app.developer_name, "Canonical");
  assert.deepEqual(app.localized_metadata, metadata.localized_metadata);
  assert.deepEqual(client.tables.store_app_platforms[0].listing_metadata, {
    custom: true,
    ...metadata,
  });
  for (const key of [
    "status",
    "version_code",
    "user_id",
    "developer_id",
    "updated_at",
  ])
    assert.deepEqual(app[key], before[key]);
  assert.equal(app.icon_url, "icon");
  // Object insertion order is not a change.
  client.tables.store_app_platforms[0].listing_metadata = Object.fromEntries(
    Object.entries(
      client.tables.store_app_platforms[0].listing_metadata,
    ).reverse(),
  );
  assert.equal(
    (await syncRecord(client, "store_apps", "app", options)).changed,
    false,
  );
  assert.equal(client.writes.length, 2);
});

test("submission insert/update events always fetch same-version metadata without publishing", async () => {
  const client = database();
  const published = structuredClone(client.tables.store_apps);
  let calls = 0;
  const fetchMetadata = async (repo, version) => {
    assert.equal(repo, "repo");
    assert.equal(version, 42);
    calls++;
    return { ...metadata, title: calls === 3 ? "Updated" : "New" };
  };
  await syncRecord(client, "luma_submissions", "sub", { fetchMetadata });
  assert.equal(
    (await syncRecord(client, "luma_submissions", "sub", { fetchMetadata }))
      .changed,
    false,
  );
  await syncRecord(client, "luma_submissions", "sub", { fetchMetadata });
  assert.equal(calls, 3);
  const sub = client.tables.luma_submissions[0];
  assert.deepEqual(sub.localized_metadata, metadata.localized_metadata);
  assert.deepEqual(
    sub.platforms[0].metadata.localized_metadata,
    metadata.localized_metadata,
  );
  assert.equal(sub.platforms[0].metadata.custom, true);
  assert.equal(sub.name, "Updated");
  assert.equal(sub.status, "Pending");
  assert.equal(sub.version_code, 42);
  assert.equal(sub.user_id, "owner");
  assert.equal(sub.platforms[0].downloadUrl, "apk");
  assert.equal(Object.hasOwn(sub, "developer_name"), false);
  assert.deepEqual(client.tables.store_apps, published);
  assert.ok(client.writes.every((write) => write.table === "luma_submissions"));
});

test("incomplete and failed metadata never write", async () => {
  for (const value of [
    null,
    { ...metadata, localized_metadata: [] },
    { ...metadata, changelog: "" },
  ]) {
    const client = database();
    await assert.rejects(
      syncRecord(client, "store_apps", "app", {
        fetchMetadata: async () => value,
      }),
      /incomplete/,
    );
    assert.equal(client.writes.length, 0);
  }
  const client = database();
  await assert.rejects(
    syncRecord(client, "store_apps", "app", {
      fetchMetadata: async () => {
        throw new Error("remote failed");
      },
    }),
    /remote failed/,
  );
  assert.equal(client.writes.length, 0);
});

test("scalar revision guards omit metadata and JSON fields", async () => {
  const client = database();
  Object.assign(client.tables.luma_submissions[0], {
    updated_at: null,
    status_updated_at: "revision",
    separate_platform_repos: true,
    description: "large".repeat(10000),
    screenshots: ["old"],
    localized_metadata: [{ locale: "old" }],
  });
  await syncRecord(client, "luma_submissions", "sub", options);
  const filters = Object.fromEntries(client.writes[0].filters);
  assert.equal(filters.updated_at, null);
  assert.equal(filters.status_updated_at, "revision");
  assert.equal(filters.status, "Pending");
  assert.equal(filters.version_code, 42);
  assert.equal(filters.user_id, "owner");
  assert.equal(filters.separate_platform_repos, true);
  for (const key of [
    "platforms",
    "description",
    "screenshots",
    "localized_metadata",
    "name",
  ])
    assert.equal(Object.hasOwn(filters, key), false);
});

test("pre-write snapshot check rejects concurrent JSON edits", async () => {
  const client = database();
  await assert.rejects(
    syncRecord(client, "luma_submissions", "sub", {
      fetchMetadata: async () => {
        client.tables.luma_submissions[0].platforms[0].repoUrl = "changed";
        return metadata;
      },
    }),
    /stale snapshot/,
  );
  assert.equal(client.writes.length, 0);
});

test("stale app and submission guards reject instead of overwriting", async () => {
  for (const [table, id] of [
    ["store_apps", "app"],
    ["luma_submissions", "sub"],
  ]) {
    const client = database();
    client.fail = (target, tables) => {
      if (target === table) tables[table][0].version_code++;
    };
    await assert.rejects(syncRecord(client, table, id, options), /stale/);
    assert.equal(client.writes.length, 0);
  }
});

test("published partial write errors propagate and a retry repairs listing", async () => {
  const client = database();
  client.fail = (table) => {
    if (table === "store_app_platforms") throw new Error("listing denied");
  };
  await assert.rejects(
    syncRecord(client, "store_apps", "app", options),
    /listing denied/,
  );
  assert.equal(client.writes.length, 1);
  client.fail = null;
  await syncRecord(client, "store_apps", "app", options);
  assert.equal(client.writes.length, 2);
});

test("inactive submissions skip loading; unsupported tables reject", async () => {
  const client = database();
  for (const status of ["Draft", "Archived"]) {
    client.tables.luma_submissions[0].status = status;
    assert.equal(
      (
        await syncRecord(client, "luma_submissions", "sub", {
          fetchMetadata: () => {
            throw new Error("unexpected fetch");
          },
        })
      ).skipped,
      "inactive",
    );
  }
  await assert.rejects(
    syncRecord(client, "other", "sub", options),
    /Unsupported/,
  );
  assert.equal(client.writes.length, 0);
});
