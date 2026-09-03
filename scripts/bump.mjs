#!/usr/bin/env node
/* Bump the extension version in manifest.json and package.json together.
   manifest.json is the source of truth (it's the version Chrome reads);
   package.json is synced to match. Usage: node scripts/bump.mjs <major|minor|patch> */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const kind = process.argv[2] || 'patch';

if (!['major', 'minor', 'patch'].includes(kind)) {
  console.error('usage: bump <major|minor|patch>');
  process.exit(1);
}

const next = (v) => {
  const [maj, min, pat] = v.split('.').map(Number);
  if ([maj, min, pat].some(Number.isNaN)) {
    console.error(`can't parse version "${v}" (expected x.y.z)`);
    process.exit(1);
  }
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
};

const manifestPath = join(root, 'manifest.json');
const version = next(JSON.parse(readFileSync(manifestPath, 'utf8')).version);

for (const file of ['manifest.json', 'package.json']) {
  const path = join(root, file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
}

console.log(`bumped to ${version} — run "npm run build" to repackage`);
