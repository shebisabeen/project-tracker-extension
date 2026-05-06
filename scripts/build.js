#!/usr/bin/env node

/**
 * Build script for Project Tracker Chrome Extension
 *
 * This script packages the extension into:
 *   1. A .zip file  — required for Chrome Web Store submission
 *   2. A .crx file  — self-signed, for local/manual distribution
 *
 * Usage:
 *   node scripts/build.js          → creates both .zip and .crx
 *   node scripts/build.js --zip    → creates only the .zip
 *   node scripts/build.js --crx    → creates only the .crx (requires a PEM key)
 *
 * Notes:
 *   • The Chrome Web Store requires a .zip file, NOT a .crx.
 *     Upload the generated .zip when submitting to the Developer Dashboard.
 *   • The .crx is useful for sideloading / testing outside the store.
 *   • A private key (key.pem) is needed to sign the .crx.
 *     If key.pem does not exist it will be auto-generated on first run.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const VERSION = MANIFEST.version;
const EXT_NAME = 'project-tracker';

// Files / directories to include in the package
const INCLUDE = [
  'manifest.json',
  'background',
  'popup',
  'icons',
  'utils',
];

// Files / patterns to exclude (relative to ROOT)
const EXCLUDE = [
  '.DS_Store',
  'node_modules',
  'dist',
  'scripts',
  '.git',
  '*.md',
  'key.pem',
  'package.json',
  'package-lock.json',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
  console.log(`\n✅  ${msg}`);
}

function warn(msg) {
  console.warn(`\n⚠️   ${msg}`);
}

function shouldExclude(filePath) {
  const rel = path.relative(ROOT, filePath);
  return EXCLUDE.some((pattern) => {
    if (pattern.startsWith('*')) {
      return rel.endsWith(pattern.slice(1));
    }
    return rel === pattern || rel.startsWith(pattern + path.sep);
  });
}

// ─── Build ZIP ────────────────────────────────────────────────────────────────

function buildZip() {
  return new Promise((resolve, reject) => {
    ensureDir(DIST);
    const outPath = path.join(DIST, `${EXT_NAME}-v${VERSION}.zip`);
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      log(`ZIP created → dist/${EXT_NAME}-v${VERSION}.zip  (${(archive.pointer() / 1024).toFixed(1)} KB)`);
      resolve(outPath);
    });

    archive.on('error', reject);
    archive.pipe(output);

    INCLUDE.forEach((entry) => {
      const fullPath = path.join(ROOT, entry);
      if (!fs.existsSync(fullPath)) {
        warn(`Skipping missing entry: ${entry}`);
        return;
      }
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        archive.directory(fullPath, entry, (entryData) => {
          return shouldExclude(path.join(ROOT, entryData.name)) ? false : entryData;
        });
      } else {
        if (!shouldExclude(fullPath)) {
          archive.file(fullPath, { name: entry });
        }
      }
    });

    archive.finalize();
  });
}

// ─── Build CRX ────────────────────────────────────────────────────────────────

/**
 * Builds a .crx file using the `crx` npm package (installed on demand) or
 * falls back to Chrome's --pack-extension flag if Chrome is available.
 *
 * The Chrome Web Store does NOT accept .crx files for submission.
 * Use the .zip file for that. The .crx is for local/manual distribution.
 */
async function buildCrx(zipPath) {
  const keyPath = path.join(ROOT, 'key.pem');

  // Try to use the `crx` npm package
  try {
    // Install crx locally if not present
    const crxBin = path.join(ROOT, 'node_modules', '.bin', 'crx');
    if (!fs.existsSync(crxBin)) {
      console.log('\n📦  Installing `crx` package locally (one-time)…');
      execSync('npm install crx --save-dev', { cwd: ROOT, stdio: 'inherit' });
    }

    const Crx = require(path.join(ROOT, 'node_modules', 'crx'));

    // Generate key if missing
    if (!fs.existsSync(keyPath)) {
      console.log('\n🔑  Generating private key (key.pem)…');
      const { generateKeyPairSync } = require('crypto');
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      fs.writeFileSync(keyPath, privateKey, 'utf8');
      warn('key.pem was created. Keep it safe — you need the SAME key for every update!');
      warn('key.pem is listed in .gitignore. Do NOT commit it.');
    }

    const crx = new Crx({
      codebase: `https://example.com/${EXT_NAME}.crx`,
      privateKey: fs.readFileSync(keyPath),
    });

    await crx.load(ROOT);
    const crxBuffer = await crx.pack();

    ensureDir(DIST);
    const crxPath = path.join(DIST, `${EXT_NAME}-v${VERSION}.crx`);
    fs.writeFileSync(crxPath, crxBuffer);
    log(`CRX created → dist/${EXT_NAME}-v${VERSION}.crx`);
    return crxPath;
  } catch (err) {
    warn(`Could not build .crx via npm crx package: ${err.message}`);
    warn('The .zip file is all you need for Chrome Web Store submission.');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const onlyZip = args.includes('--zip');
  const onlyCrx = args.includes('--crx');

  console.log(`\n🚀  Building ${MANIFEST.name} v${VERSION}…`);

  ensureDir(DIST);

  let zipPath;

  if (!onlyCrx) {
    zipPath = await buildZip();
  }

  if (!onlyZip) {
    if (!zipPath) {
      // Need zip as intermediate step for crx
      zipPath = await buildZip();
    }
    await buildCrx(zipPath);
  }

  console.log('\n📁  Output directory: dist/');
  console.log('');
  console.log('📌  Chrome Web Store submission:');
  console.log(`    Upload  dist/${EXT_NAME}-v${VERSION}.zip  at`);
  console.log('    https://chrome.google.com/webstore/devconsole');
  console.log('');
}

main().catch((err) => {
  console.error('\n❌  Build failed:', err);
  process.exit(1);
});
