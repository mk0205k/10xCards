import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MESSAGES_DIR = "messages";
const IGNORED_KEYS = new Set(["$schema"]);

const files = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"));
if (files.length < 2) {
  console.log(`[i18n-parity] only ${files.length} locale file(s); skipping parity check.`);
  process.exit(0);
}

const byLocale = new Map();
for (const file of files) {
  const locale = file.replace(/\.json$/, "");
  const contents = JSON.parse(readFileSync(join(MESSAGES_DIR, file), "utf8"));
  const keys = new Set(Object.keys(contents).filter((k) => !IGNORED_KEYS.has(k)));
  byLocale.set(locale, keys);
}

const allKeys = new Set();
for (const keys of byLocale.values()) {
  for (const k of keys) allKeys.add(k);
}

const missing = [];
for (const key of allKeys) {
  for (const [locale, keys] of byLocale) {
    if (!keys.has(key)) missing.push({ key, locale });
  }
}

if (missing.length > 0) {
  console.error(`[i18n-parity] ${missing.length} missing translation(s):`);
  for (const { key, locale } of missing) {
    console.error(`  - "${key}" missing in messages/${locale}.json`);
  }
  process.exit(1);
}

console.log(`[i18n-parity] OK — ${allKeys.size} key(s) present in all ${byLocale.size} locale(s).`);
