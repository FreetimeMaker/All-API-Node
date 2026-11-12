const { test } = require("node:test");
const assert = require("node:assert/strict");
const { enrichApps, fetchFastlane } = require("./luma-metadata");
const sha = "a".repeat(40);

function multilingualFixture() {
  const base = fixture();
  const state = { title: "Titre", fail: false };
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    const parsed = new URL(url);
    const path = parsed.pathname;
    const json = (value) => ({ ok: true, json: async () => value });
    const files = (names) => names.map((name) => ({ type: "file", name }));
    if (path.endsWith("/contents/fastlane/metadata/android"))
      return json(
        ["fr-FR", "changelogs", "es", "en-US", "it", "images"].map((name) => ({
          type: "dir",
          name,
        })),
      );
    if (path.includes("/fr-FR")) {
      if (state.fail && path.endsWith("/images"))
        return { ok: false, status: 503 };
      if (path.endsWith("/fr-FR"))
        return json(files(["title.txt", "full_description.txt"]));
      if (path.endsWith("/title.txt"))
        return { ok: true, text: async () => state.title };
      if (path.endsWith("/full_description.txt"))
        return { ok: true, text: async () => "Description française" };
      if (path.endsWith("/images")) return json(files(["icon.png"]));
      if (path.endsWith("/changelogs"))
        return json(files(["41.txt", "default.txt"]));
      if (path.endsWith("/default.txt"))
        return { ok: true, text: async () => "Changements français" };
      return { ok: false, status: 404 };
    }
    if (path.includes("/es")) {
      if (path.endsWith("/es")) return json(files(["short_description.txt"]));
      if (path.endsWith("/short_description.txt"))
        return { ok: true, text: async () => "Resumen" };
      if (path.endsWith("/changelogs")) return json(files(["41.txt"]));
      return { ok: false, status: 404 };
    }
    if (path.includes("/it")) return json([]);
    return base.fetcher(url, options);
  };
  return { state, calls, fetcher };
}

function fixture({ incomplete = false, fail = false } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (fail) throw new Error("offline");
    let value;
    if (url.includes("raw.githubusercontent.com")) {
      value = url.endsWith("title.txt")
        ? " Current title\n"
        : " Current text\n";
      return { ok: true, text: async () => value };
    }
    if (url.endsWith("/commits/main")) value = { sha };
    else if (!url.includes("/contents/")) value = { default_branch: "main" };
    else if (url.includes("/phoneScreenshots?"))
      value = incomplete ? [] : [{ type: "file", name: "1.webp" }];
    else if (url.includes("/images?"))
      value = [
        { type: "file", name: "icon.webp" },
        { type: "file", name: "featureGraphic.webp" },
      ];
    else if (url.includes("/changelogs?"))
      value = [
        { type: "file", name: "42.txt" },
        { type: "file", name: "default.txt" },
      ];
    else if (url.includes("/en-US?"))
      value = [
        "title.txt",
        "short_description.txt",
        "full_description.txt",
      ].map((name) => ({ type: "file", name }));
    else value = [{ type: "dir", name: "en-US" }];
    return { ok: true, json: async () => value };
  };
  return { calls, fetcher };
}

test("enrichment refreshes the primary icon without using a translated icon", async () => {
  const originalFetch = global.fetch;
  global.fetch = multilingualFixture().fetcher;
  try {
    const [result] = await enrichApps(null, [
      {
        icon_url: "old-icon",
        repo_url: "https://github.com/test/translated-icons",
        platforms: [{ platform: "Android", version_code: 42 }],
      },
    ]);
    const listing = result.platforms[0].listing_metadata;
    const translated = result.localized_metadata.find(
      (entry) => entry.locale === "fr-FR",
    );
    assert.match(translated.icon, /fr-FR\/images\/icon.png$/);
    assert.match(result.icon_url, /en-US\/images\/icon.webp$/);
    assert.equal(result.icon_url, listing.icon);
    assert.notEqual(result.icon_url, translated.icon);
  } finally {
    global.fetch = originalFetch;
  }
});

test("locale loading uses at most four workers and preserves ranked output order", async () => {
  const base = fixture();
  const locales = ["pt-BR", "fr-FR", "es", "it", "de-DE", "en-US"];
  let active = 0;
  let peak = 0;
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/contents/fastlane/metadata/android"))
      return {
        ok: true,
        json: async () => locales.map((name) => ({ type: "dir", name })),
      };
    const match = path.match(
      /\/contents\/fastlane\/metadata\/android\/([^/]+)$/,
    );
    if (match) {
      active++;
      peak = Math.max(peak, active);
      return {
        ok: true,
        json: async () => {
          await new Promise((resolve) =>
            setTimeout(resolve, match[1] === "en-US" ? 20 : 5),
          );
          active--;
          return [
            "title.txt",
            "short_description.txt",
            "full_description.txt",
          ].map((name) => ({ type: "file", name }));
        },
      };
    }
    return base.fetcher(url, options);
  };
  const result = await fetchFastlane(
    "https://github.com/test/concurrent-locales",
    42,
    fetcher,
  );
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.equal(result.locale, "en-US");
  assert.deepEqual(
    result.localized_metadata.map((entry) => entry.locale),
    ["en-US", "de-DE", "es", "fr-FR", "it", "pt-BR"],
  );
});

test("all valid locales retain translated fields with primary fallbacks and immutable URLs", async () => {
  const { fetcher, calls } = multilingualFixture();
  const result = await fetchFastlane(
    "https://github.com/test/multilingual",
    42,
    fetcher,
  );
  assert.equal(result.locale, "en-US");
  assert.equal(result.commitSha, sha);
  assert.equal(result.branch, "main");
  assert.deepEqual(
    result.localized_metadata.map((entry) => entry.locale),
    ["en-US", "es", "fr-FR", "it"],
  );
  const [, es, fr, it] = result.localized_metadata;
  assert.equal(fr.title, "Titre");
  assert.equal(fr.fullDescription, "Description française");
  assert.equal(fr.shortDescription, result.shortDescription);
  assert.equal(fr.changelog, "Changements français");
  assert.deepEqual(fr.screenshots, result.screenshots);
  assert.equal(es.shortDescription, "Resumen");
  assert.equal(es.changelog, result.changelog);
  assert.equal(it.title, result.title);
  assert.ok(!calls.some((url) => url.endsWith("/41.txt")));
  for (const entry of [result, ...result.localized_metadata]) {
    for (const url of [
      ...entry.screenshots,
      entry.icon,
      entry.featureGraphic,
    ].filter(Boolean))
      assert.ok(url.includes(`/${sha}/`));
  }
  assert.ok(
    calls
      .filter((url) => url.includes("/contents/"))
      .every((url) => url.endsWith(`ref=${sha}`)),
  );
  assert.ok(
    calls
      .filter((url) => url.includes("raw.githubusercontent.com"))
      .every((url) => url.includes(`/${sha}/`)),
  );
});

test("fresh bypasses success, failure and pending caches and updates subsequent API reads", async () => {
  const { fetcher, state } = multilingualFixture();
  const repo = "https://github.com/test/fresh";
  const first = await fetchFastlane(repo, 42, fetcher);
  state.title = "Nouveau titre";
  assert.equal(await fetchFastlane(repo, 42, fetcher), first);
  const updated = await fetchFastlane(repo, 42, fetcher, { fresh: true });
  assert.equal(updated.localized_metadata[2].title, state.title);
  assert.equal(await fetchFastlane(repo, 42, fetcher), updated);
  const warn = console.warn;
  console.warn = () => {};
  try {
    state.fail = true;
    assert.equal(await fetchFastlane(repo, 42, fetcher, { fresh: true }), null);
    state.fail = false;
    assert.equal(await fetchFastlane(repo, 42, fetcher), null);
    assert.ok(await fetchFastlane(repo, 42, fetcher, { fresh: true }));
  } finally {
    console.warn = warn;
  }
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const pendingRepo = "https://github.com/test/fresh-pending";
  const pending = fetchFastlane(pendingRepo, 42, async (...args) => {
    await blocked;
    return fetcher(...args);
  });
  const fresh = await fetchFastlane(pendingRepo, 42, fetcher, { fresh: true });
  release();
  await pending;
  assert.equal(await fetchFastlane(pendingRepo, 42, fetcher), fresh);
});

test("a secondary locale read failure preserves all stored translations atomically", async () => {
  const { fetcher, state } = multilingualFixture();
  state.fail = true;
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  global.fetch = fetcher;
  console.warn = () => {};
  const localized_metadata = ["en-US", "es", "fr-FR"].map((locale) => ({
    locale,
    title: "Stored",
  }));
  const apps = [
    {
      name: "Stored",
      localized_metadata,
      repo_url: "https://github.com/test/locale-error",
      platforms: [
        {
          platform: "Android",
          version_code: 42,
          listing_metadata: { localized_metadata },
        },
      ],
    },
  ];
  const snapshot = structuredClone(apps);
  try {
    assert.deepEqual(await enrichApps(null, apps), snapshot);
    assert.deepEqual(apps, snapshot);
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("complete metadata is SHA pinned, supports webp and singleflight success caching", async () => {
  const { calls, fetcher } = fixture();
  const [one, two] = await Promise.all([
    fetchFastlane("https://github.com/test/success.git", 42, fetcher),
    fetchFastlane("https://github.com/test/success", 42, fetcher),
  ]);
  assert.equal(one, two);
  assert.equal(one.title, "Current title");
  assert.match(one.icon, /icon.webp$/);
  assert.match(one.featureGraphic, /featureGraphic.webp$/);
  assert.ok(one.screenshots[0].includes(sha));
  assert.ok(
    calls
      .filter((call) => call.url.includes("/contents/"))
      .every((call) => call.url.endsWith(`ref=${sha}`)),
  );
  const count = calls.length;
  await fetchFastlane("https://github.com/test/success", 42, fetcher);
  assert.equal(calls.length, count);
});

test("incomplete metadata fails atomically and failures are cached with one warning", async () => {
  const { calls, fetcher } = fixture({ incomplete: true });
  const original = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(message);
  try {
    assert.equal(
      await fetchFastlane("https://github.com/test/incomplete", 42, fetcher),
      null,
    );
    const count = calls.length;
    assert.equal(
      await fetchFastlane("https://github.com/test/incomplete", 42, fetcher),
      null,
    );
    assert.equal(calls.length, count);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /No complete Fastlane locale/);
  } finally {
    console.warn = original;
  }
});

test("rejects non-HTTPS and non-repository GitHub URLs without fetching", async () => {
  const fetcher = () => assert.fail("must not fetch");
  for (const url of [
    "http://github.com/a/b",
    "https://evil.test/a/b",
    "https://github.com/a/b/tree/main",
    "https://user:secret@github.com/a/b",
    "https://github.com/a/b?x=1",
  ]) {
    assert.equal(await fetchFastlane(url, 1, fetcher), null);
  }
});

test("enrichment batches canonical profiles and preserves ownership, releases and other listing fields", async () => {
  const original = global.fetch;
  const { fetcher, calls } = fixture();
  global.fetch = fetcher;
  const queries = [];
  const client = {
    from(table) {
      assert.equal(table, "luma_developer_profiles");
      return {
        select(columns) {
          assert.equal(columns, "developer_id,display_name");
          return {
            in: async (column, ids) => {
              queries.push({ column, ids });
              return {
                data: [
                  { developer_id: "dev", display_name: " Canonical " },
                  { developer_id: "blank", display_name: " " },
                ],
              };
            },
          };
        },
      };
    },
  };
  const apps = [
    {
      name: "Old",
      icon_url: "original-icon",
      developer_id: "dev",
      developer_name: "Old dev",
      author: "Author",
      repo_url: "https://github.com/test/enrichment",
      version: "1",
      platforms: [
        {
          platform: "Android",
          version_code: 42,
          download_url: "apk",
          listing_metadata: { custom: true },
        },
        { platform: "Web", listing_metadata: { title: "Web" } },
      ],
    },
    { developer_id: "blank", developer_name: "Keep" },
  ];
  const snapshot = structuredClone(apps);
  try {
    const result = await enrichApps(client, apps);
    assert.deepEqual(queries, [
      { column: "developer_id", ids: ["dev", "blank"] },
    ]);
    assert.equal(result[0].name, "Current title");
    assert.equal(
      result[0].icon_url,
      `https://raw.githubusercontent.com/test/enrichment/${sha}/fastlane/metadata/android/en-US/images/icon.webp`,
    );
    assert.deepEqual(
      result[0].localized_metadata,
      result[0].platforms[0].listing_metadata.localized_metadata,
    );
    assert.equal(result[0].developer_name, "Canonical");
    assert.equal(result[1].developer_name, "Keep");
    assert.equal(result[0].author, "Author");
    assert.equal(result[0].version, "1");
    assert.equal(result[0].platforms[0].download_url, "apk");
    assert.equal(result[0].platforms[0].version_code, 42);
    assert.equal(result[0].platforms[0].listing_metadata.custom, true);
    assert.equal(
      result[0].platforms[0].listing_metadata.shortDescription,
      "Current text",
    );
    assert.deepEqual(result[0].platforms[1], apps[0].platforms[1]);
    assert.deepEqual(apps, snapshot);
    assert.ok(
      calls
        .filter((call) => call.url.includes("raw.githubusercontent.com"))
        .every((call) => !call.options.headers.Authorization),
    );
  } finally {
    global.fetch = original;
  }
});

test("profile and remote failures retain existing metadata", async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  global.fetch = fixture({ fail: true }).fetcher;
  console.warn = () => {};
  const apps = [
    {
      name: "Keep",
      description: "Keep full",
      developer_name: "Keep dev",
      developer_id: "dev",
      repo_url: "https://github.com/test/failure",
      platforms: [{ platform: "Android", listing_metadata: { title: "Keep" } }],
    },
  ];
  try {
    const result = await enrichApps(
      {
        from() {
          throw new Error("database unavailable");
        },
      },
      apps,
    );
    assert.deepEqual(result, apps);
    assert.notEqual(result, apps);
    assert.deepEqual(await enrichApps(null, []), []);
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
