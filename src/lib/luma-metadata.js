const cache = new Map();
const LOCALES = ["en-US", "en-GB", "de-DE", "en", "de"];

function repository(value) {
  const url = new URL(value);
  const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match ||
    match.slice(1).some((part) => part === "." || part === "..")
  ) {
    throw new Error("Expected an HTTPS github.com owner/repository URL");
  }
  return `${match[1]}/${match[2]}`;
}

async function request(url, fetcher, json = true, optional = false) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["api.github.com", "raw.githubusercontent.com"].includes(
      parsed.hostname,
    ) ||
    parsed.port ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Untrusted GitHub metadata URL");
  const headers = {
    Accept: json ? "application/vnd.github+json" : "text/plain",
  };
  const token = process.env.GITHUB_TOKEN;
  if (parsed.hostname === "api.github.com" && token)
    headers.Authorization = `Bearer ${token}`;
  const signal = AbortSignal.timeout(10000);
  // Bound body consumption too, including fetch implementations that ignore abort.
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, {
          headers,
          signal,
          redirect: "error",
        });
        if (optional && response.status === 404) return null;
        if (!response.ok)
          throw new Error(`GitHub HTTP ${response.status}: ${parsed.pathname}`);
        return json ? await response.json() : await response.text();
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("GitHub metadata timeout (10s)")),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function load(repo, versionCode, fetcher) {
  const api = `https://api.github.com/repos/${repo}`;
  const info = await request(api, fetcher);
  if (!info.default_branch) throw new Error("Repository has no default branch");
  const commit = await request(
    `${api}/commits/${encodeURIComponent(info.default_branch)}`,
    fetcher,
  );
  if (!/^[a-f0-9]{40}$/i.test(commit.sha))
    throw new Error("Invalid commit SHA");
  const sha = commit.sha;
  const contents = async (path, optional = false) => {
    const result = await request(
      `${api}/contents/${path}?ref=${sha}`,
      fetcher,
      true,
      optional,
    );
    if (result === null) return [];
    if (!Array.isArray(result))
      throw new Error(`Expected GitHub directory: ${path}`);
    return result;
  };
  const root = "fastlane/metadata/android";
  const locales = (await contents(root))
    .filter(
      (entry) =>
        entry.type === "dir" &&
        /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(entry.name),
    )
    .map((entry) => entry.name);
  locales.sort((a, b) => {
    const rank = (value) =>
      LOCALES.includes(value) ? LOCALES.indexOf(value) : LOCALES.length;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const raw = (path) =>
    `https://raw.githubusercontent.com/${repo}/${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const translations = new Array(locales.length);
  const loadLocale = async (locale) => {
    const path = `${root}/${encodeURIComponent(locale)}`;
    const files = await contents(path);
    const text = async (name) => {
      const file = files.find(
        (entry) => entry.type === "file" && entry.name === name,
      );
      return file
        ? (
            await request(
              raw(`${root}/${locale}/${name}`),
              fetcher,
              false,
              true,
            )
          )?.trim() || ""
        : "";
    };
    const [title, shortDescription, fullDescription, changes, images, shots] =
      await Promise.all([
        text("title.txt"),
        text("short_description.txt"),
        text("full_description.txt"),
        contents(`${path}/changelogs`, true),
        contents(`${path}/images`, true),
        contents(`${path}/images/phoneScreenshots`, true),
      ]);
    const change = [
      versionCode == null ? null : `${versionCode}.txt`,
      "default.txt",
    ]
      .filter(Boolean)
      .map((name) =>
        changes.find((entry) => entry.type === "file" && entry.name === name),
      );
    let changelog = "";
    for (const file of change) {
      if (file)
        changelog =
          (
            await request(
              raw(`${root}/${locale}/changelogs/${file.name}`),
              fetcher,
              false,
              true,
            )
          )?.trim() || "";
      if (changelog) break;
    }
    const imageFiles = (entries) =>
      entries.filter(
        (entry) =>
          entry.type === "file" && /\.(png|jpe?g|webp)$/i.test(entry.name),
      );
    const screenshots = imageFiles(shots)
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
      .map((file) =>
        raw(`${root}/${locale}/images/phoneScreenshots/${file.name}`),
      );

    const image = (stem) => {
      const file = imageFiles(images).find(
        (entry) => entry.name.replace(/\.[^.]+$/, "") === stem,
      );
      return file ? raw(`${root}/${locale}/images/${file.name}`) : undefined;
    };
    return {
      locale,
      title,
      shortDescription,
      fullDescription,
      changelog,
      screenshots,
      ...(image("icon") ? { icon: image("icon") } : {}),
      ...(image("featureGraphic")
        ? { featureGraphic: image("featureGraphic") }
        : {}),
    };
  };
  let nextLocale = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, locales.length) }, async () => {
      while (nextLocale < locales.length) {
        const index = nextLocale++;
        translations[index] = await loadLocale(locales[index]);
      }
    }),
  );
  const primary = translations.find(
    (entry) =>
      entry.title &&
      entry.shortDescription &&
      entry.fullDescription &&
      entry.changelog &&
      entry.screenshots.length,
  );
  if (!primary)
    throw new Error(
      "No complete Fastlane locale (title, descriptions, changelog and phone screenshots required)",
    );
  const localized_metadata = translations.map((entry) => {
    const localized = { ...primary, locale: entry.locale };
    for (const [field, value] of Object.entries(entry)) {
      if (Array.isArray(value) ? value.length : value) localized[field] = value;
    }
    return localized;
  });
  return {
    ...primary,
    localized_metadata,
    commitSha: sha,
    branch: info.default_branch,
  };
}

async function fetchFastlane(
  repoUrl,
  versionCode,
  fetcher = fetch,
  options = { fresh: false },
) {
  let repo;
  try {
    repo = repository(repoUrl);
  } catch {
    return null;
  } // Unsupported sources are not Fastlane candidates.
  const key = JSON.stringify([
    repo.toLowerCase(),
    versionCode == null ? null : String(versionCode),
  ]);
  const existing = cache.get(key);
  if (
    !options.fresh &&
    existing &&
    (existing.pending || existing.expires > Date.now())
  )
    return existing.promise;
  const entry = { pending: true, expires: 0 };
  entry.promise = load(repo, versionCode, fetcher)
    .then((result) => {
      entry.expires = Date.now() + 300000;
      return result;
    })
    .catch((error) => {
      entry.expires = Date.now() + 60000;
      console.warn(
        `Fastlane metadata ${repo} (version ${versionCode ?? "default"}): ${error.message}`,
      );
      return null;
    })
    .finally(() => {
      entry.pending = false;
    });
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > 200) cache.delete(cache.keys().next().value);
  return entry.promise;
}

async function enrichApps(client, apps) {
  const rows = Array.isArray(apps) ? apps : [];
  const names = new Map();
  const ids = [...new Set(rows.map((app) => app.developer_id).filter(Boolean))];
  if (ids.length && client) {
    try {
      const { data, error } = await client
        .from("luma_developer_profiles")
        .select("developer_id,display_name")
        .in("developer_id", ids);
      if (error) throw error;
      for (const profile of data || []) {
        if (
          typeof profile.display_name === "string" &&
          profile.display_name.trim()
        ) {
          names.set(profile.developer_id, profile.display_name.trim());
        }
      }
    } catch (error) {
      console.warn(`Luma profile metadata: ${error.message}`);
    }
  }
  return Promise.all(
    rows.map(async (app) => {
      const result = { ...app };
      if (names.has(app.developer_id))
        result.developer_name = names.get(app.developer_id);
      const android = (app.platforms || []).find(
        (platform) => String(platform.platform).toLowerCase() === "android",
      );
      const repo = android?.repo_url || app.repo_url || app.source_code_url;
      if (!android || !repo) return result;
      const metadata = await fetchFastlane(
        repo,
        android?.version_code ?? app.version_code,
      );
      if (!metadata) return result;
      Object.assign(result, {
        name: metadata.title,
        short_description: metadata.shortDescription,
        description: metadata.fullDescription,
        changelog: metadata.changelog,
        screenshots: metadata.screenshots,
        localized_metadata: metadata.localized_metadata,
      });
      if (metadata.icon) result.icon_url = metadata.icon;

      if (Array.isArray(app.platforms))
        result.platforms = app.platforms.map((platform) =>
          String(platform.platform).toLowerCase() === "android"
            ? {
                ...platform,
                listing_metadata: { ...platform.listing_metadata, ...metadata },
              }
            : platform,
        );
      return result;
    }),
  );
}

module.exports = { enrichApps, fetchFastlane };
