// Copies the Recovery & Install Kit from the backend into public/recovery/ so
// the web app can hand technicians the exact scripts that match this build.
//
// Runs automatically before every `npm run build` (see package.json prebuild),
// which keeps ONE source of truth: backend/MILO-Backend-main/deploy/.
//
// After deploying the frontend, the installer is live at:
//     https://<your-domain>/recovery/install.sh

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../backend/MILO-Backend-main/deploy');
const DEST = resolve(here, '../public/recovery');

const FILES = [
  ['kit.conf', 'Kit settings', 'Your repository, site and model addresses.'],
  ['install.sh', 'Installer & repair tool', 'Rebuilds a machine from scratch, or repairs a broken one.'],
  ['milo-doctor.sh', 'Diagnostics', 'Health check with automatic repair.'],
  ['milo-update.sh', 'Update agent', 'Over-the-air updates with automatic rollback.'],
  ['milo-backup.sh', 'Backup & restore', 'Database snapshots, rotation and restore.'],
  ['milo-bundle.sh', 'Offline bundle builder', 'Builds a USB-stick recovery bundle.'],
  ['milo-config-ui.py', 'Repair UI', 'The on-device web interface.'],
  ['milo', 'milo command', 'The technician command-line tool.'],
  ['RECOVERY.md', 'Technician handbook', 'Every recovery scenario, step by step.'],
];

if (!existsSync(SRC)) {
  console.warn(`[recovery] ${SRC} not found — skipping (frontend-only checkout?)`);
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });

// Deployment addresses come from the kit's single config file, so the command
// shown in the app always matches what the installer will actually use.
let site = '';
let repo = '';
const kitConf = join(SRC, 'kit.conf');
if (existsSync(kitConf)) {
  const txt = readFileSync(kitConf, 'utf8');
  site = (txt.match(/^\s*MILO_SITE\s*=\s*"?([^"#\n]+)"?/m)?.[1] || '').trim().replace(/\/+$/, '');
  repo = (txt.match(/^\s*MILO_REPO\s*=\s*"?([^"#\n]+)"?/m)?.[1] || '').trim();
}

// Keep the kit's version tied to the backend build it was tested against.
let version = 'unknown';
const backendMain = resolve(SRC, '../milo-detect.py');
if (existsSync(backendMain)) {
  const m = readFileSync(backendMain, 'utf8').match(/BACKEND_BUILD\s*=\s*'([^']+)'/);
  if (m) version = m[1];
}

const entries = [];
for (const [name, title, description] of FILES) {
  const from = join(SRC, name);
  if (!existsSync(from)) { console.warn(`[recovery] missing: ${name}`); continue; }
  const buf = readFileSync(from);
  copyFileSync(from, join(DEST, name));
  entries.push({
    file: name, title, description,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  });
}

writeFileSync(join(DEST, 'manifest.json'), JSON.stringify({
  kit: 'MILO Recovery & Install Kit',
  version,
  repo,
  site,
  generated_at: new Date().toISOString(),
  // Falls back to the browser's own origin at runtime when site is unset.
  install_command: site ? `curl -fsSL ${site}/recovery/install.sh | sudo bash` : '',
  files: entries,
}, null, 2) + '\n');

console.log(`[recovery] synced ${entries.length} files (kit ${version}) -> public/recovery/`);
console.log(`[recovery] repo=${repo || '(unset)'} site=${site || '(using app origin)'}`);
