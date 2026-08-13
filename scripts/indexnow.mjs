#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ORIGIN = "https://webtaskkit.com";
const INDEXNOW_KEY = "f18459e3755ff46c2215f3d8ce96f916";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10_000;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const SITE = new URL(SITE_ORIGIN);
const DEFAULT_SITEMAP = new URL("/sitemap.xml", SITE).href;
const KEY_FILE = path.join(PROJECT_ROOT, "public", `${INDEXNOW_KEY}.txt`);
const KEY_LOCATION = new URL(`/${INDEXNOW_KEY}.txt`, SITE).href;
const STATE_FILE = path.join(PROJECT_ROOT, "outputs", "indexnow-state.json");

function usage() {
  console.log(`IndexNow helper for ${SITE.hostname}

Usage:
  node scripts/indexnow.mjs [options]

Options:
  --sitemap <url|file|->  Sitemap source (default: ${DEFAULT_SITEMAP}; - reads stdin)
  --url <canonical-url>   Submit one changed URL; repeat for more URLs
  --all                   Treat every current sitemap URL as changed
  --submit                Send the request; otherwise this is a dry run
  --confirm-host <host>   Required with --submit; must equal ${SITE.hostname}
  --help                  Show this help

The default is intentionally non-mutating: it never calls IndexNow or writes state.
`);
}

function parseArguments(argv) {
  const options = {
    sitemap: DEFAULT_SITEMAP,
    urls: [],
    all: false,
    submit: false,
    confirmHost: "",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
    } else if (argument === "--all") {
      options.all = true;
    } else if (argument === "--submit") {
      options.submit = true;
    } else if (argument === "--sitemap" || argument === "--url" || argument === "--confirm-host") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === "--sitemap") options.sitemap = value;
      if (argument === "--url") options.urls.push(value);
      if (argument === "--confirm-host") options.confirmHost = value;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (options.all && options.urls.length > 0) {
    throw new Error("Use either --all or one or more --url options, not both.");
  }
  if (options.submit && options.confirmHost !== SITE.hostname) {
    throw new Error(`Submitting requires --confirm-host ${SITE.hostname}.`);
  }

  return options;
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function isInsideProject(candidate) {
  const relative = path.relative(PROJECT_ROOT, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function loadSitemap(source) {
  if (source === "-") return readStandardInput();

  if (/^https?:\/\//i.test(source)) {
    const sitemapUrl = new URL(source);
    if (sitemapUrl.origin !== SITE.origin) {
      throw new Error(`Remote sitemap must be hosted at ${SITE.origin}.`);
    }
    const response = await fetch(sitemapUrl, {
      headers: { accept: "application/xml,text/xml;q=0.9" },
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(`Could not read sitemap: HTTP ${response.status}.`);
    }
    return response.text();
  }

  const sitemapPath = path.resolve(process.cwd(), source);
  if (!isInsideProject(sitemapPath)) {
    throw new Error("Local sitemap must be inside this project.");
  }
  return readFile(sitemapPath, "utf8");
}

function decodeXml(value) {
  const unwrapped = value.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1");
  return unwrapped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function normalizeCanonical(value) {
  const url = new URL(value);
  if (url.origin !== SITE.origin || url.protocol !== "https:") {
    throw new Error(`Sitemap URL is outside the canonical origin: ${value}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`Canonical URLs cannot contain credentials, a query, or a fragment: ${value}`);
  }
  return url.href;
}

function normalizeLastModified(value, url) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw new Error(`Invalid <lastmod> for ${url}: ${value}`);
  }
  return new Date(milliseconds).toISOString();
}

function parseSitemap(xml) {
  if (!/<(?:\w+:)?urlset\b/i.test(xml)) {
    throw new Error("Expected a URL-set sitemap. Pass a leaf sitemap, not a sitemap index.");
  }

  const entries = new Map();
  const blocks = xml.matchAll(/<(?:\w+:)?url\b[^>]*>([\s\S]*?)<\/(?:\w+:)?url>/gi);
  for (const match of blocks) {
    const location = extractTag(match[1], "loc");
    if (!location) throw new Error("Every sitemap <url> entry must contain <loc>.");
    const canonical = normalizeCanonical(location);
    const lastModified = normalizeLastModified(extractTag(match[1], "lastmod"), canonical);
    if (entries.has(canonical)) throw new Error(`Duplicate sitemap URL: ${canonical}`);
    entries.set(canonical, lastModified);
  }

  if (entries.size === 0) throw new Error("The sitemap contains no canonical URLs.");
  if (entries.size > MAX_URLS) throw new Error(`The sitemap exceeds IndexNow's ${MAX_URLS}-URL request limit.`);
  return entries;
}

async function readState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, "utf8"));
    if (parsed.version !== 1 || parsed.origin !== SITE.origin || typeof parsed.urls !== "object" || !parsed.urls) {
      throw new Error("State metadata does not match this site.");
    }
    const urls = new Map();
    for (const [url, lastModified] of Object.entries(parsed.urls)) {
      urls.set(normalizeCanonical(url), lastModified ?? null);
    }
    return urls;
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw new Error(`Could not read IndexNow state: ${error.message}`);
  }
}

function selectChangedUrls(current, previous, options) {
  if (options.urls.length > 0) {
    const selected = new Set();
    for (const value of options.urls) {
      const canonical = normalizeCanonical(value);
      if (!current.has(canonical) && !previous.has(canonical)) {
        throw new Error(`Requested URL is absent from both the current sitemap and prior state: ${canonical}`);
      }
      selected.add(canonical);
    }
    return [...selected].sort();
  }

  const changed = new Set();
  for (const [url, lastModified] of current) {
    if (options.all || !previous.has(url) || previous.get(url) !== lastModified) changed.add(url);
  }
  for (const url of previous.keys()) {
    if (!current.has(url)) changed.add(url);
  }
  return [...changed].sort();
}

async function assertKeyFile() {
  const value = (await readFile(KEY_FILE, "utf8")).trim();
  if (value !== INDEXNOW_KEY) throw new Error("The public IndexNow key file does not match the configured key.");
}

async function saveState(current, previous, submitted) {
  const next = new Map(previous);
  for (const url of submitted) {
    if (current.has(url)) next.set(url, current.get(url));
    else next.delete(url);
  }

  const urls = Object.fromEntries([...next.entries()].sort(([left], [right]) => left.localeCompare(right)));
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(
    STATE_FILE,
    `${JSON.stringify({ version: 1, origin: SITE.origin, updatedAt: new Date().toISOString(), urls }, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  await assertKeyFile();
  const current = parseSitemap(await loadSitemap(options.sitemap));
  const previous = await readState();
  const changed = selectChangedUrls(current, previous, options);

  console.log(`${SITE.hostname}: ${current.size} canonical sitemap URLs; ${changed.length} changed.`);
  for (const url of changed) console.log(`- ${url}`);

  if (changed.length === 0) return;
  if (!options.submit) {
    console.log("Dry run only. No IndexNow request was sent and state was not changed.");
    return;
  }

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: SITE.hostname,
      key: INDEXNOW_KEY,
      keyLocation: KEY_LOCATION,
      urlList: changed,
    }),
  });

  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow rejected the request with HTTP ${response.status}; state was not changed.`);
  }

  await saveState(current, previous, changed);
  console.log(`IndexNow accepted ${changed.length} URL(s) with HTTP ${response.status}.`);
}

main().catch((error) => {
  console.error(`IndexNow: ${error.message}`);
  process.exitCode = 1;
});
