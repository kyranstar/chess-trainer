#!/usr/bin/env node
// Lists the positions the owner flagged in the app for a later look (ADR-059), from the
// backup copy the phone sent to his private repository. Run at the start of every session:
//
//   scripts/fetch-practice.sh && node scripts/flags.mjs          # flags not yet handled
//   node scripts/flags.mjs --all                                 # every flag in the copy
//   node scripts/flags.mjs --done <exercise id> "<what was found or done>"
//
// What was handled is kept in data/flags-handled.json. data/ is git-ignored: the flags hold
// positions from his own games and what his screen said, and the repository is public.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backupPath = process.env.BACKUP ?? join(root, 'data/remote/backup.json');
const handledPath = join(root, 'data/flags-handled.json');
const handled = existsSync(handledPath) ? JSON.parse(readFileSync(handledPath, 'utf8')) : {};
const args = process.argv.slice(2);

if (args[0] === '--done') {
  const [, id, note = ''] = args;
  if (!id) throw new Error('Give the exercise id of the flag that was handled.');
  const flag = existsSync(backupPath) ? flagsIn(JSON.parse(readFileSync(backupPath, 'utf8'))).find((f) => f.id === id) : undefined;
  handled[id] = { flaggedAt: flag?.ts ?? null, handledAt: new Date().toISOString(), note };
  writeFileSync(handledPath, `${JSON.stringify(handled, null, 1)}\n`);
  console.log(`Marked handled: ${id}`);
  process.exit(0);
}

if (!existsSync(backupPath)) {
  console.log(`No backup copy at ${backupPath}. Run scripts/fetch-practice.sh first (it needs the GitHub CLI signed in as the owner).`);
  process.exit(2);
}
const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
const flags = flagsIn(backup);
// A flag set again after it was handled is a new request.
const open = flags.filter((f) => args.includes('--all') || !handled[f.id] || (handled[f.id].flaggedAt ?? 0) < f.ts);
console.log(`Backup written ${backup.manifest.exportTime}: ${flags.length} flag${flags.length === 1 ? '' : 's'}, ${open.length} to look at.`);
for (const f of open) {
  const attempts = backup.data.attempts.filter((a) => a.exerciseId === f.id).sort((a, b) => a.ts - b.ts);
  console.log(`\n[${f.kind}] ${f.id}   flagged ${new Date(f.ts).toISOString()}   app ${f.app}${handled[f.id] ? '   (handled before, flagged again)' : ''}`);
  // A flag on any screen (ADR-063): where it was set, its heading and the owner's note.
  if (f.route) console.log(`  screen: ${f.route}${f.heading ? `   "${f.heading}"` : ''}`);
  if (f.note) console.log(`  note: ${f.note}`);
  console.log(`  position: ${f.fen ?? 'not recorded'}`);
  console.log(`  the screen said: ${f.said}`);
  console.log(`  state: ${JSON.stringify(f.state)}`);
  for (const a of attempts) console.log(`  answer ${new Date(a.ts).toISOString()} ${a.context}: ${a.outcome}; played ${JSON.stringify(a.played)}; ${JSON.stringify(a.themes)}`);
}
if (open.length) console.log('\nLook at each one, tell the owner what was found, fix what is a defect, then: node scripts/flags.mjs --done <id> "<note>"');

function flagsIn(file) {
  return (file.data.settings ?? []).filter((r) => typeof r.key === 'string' && r.key.startsWith('flag:')).map((r) => r.value).sort((a, b) => b.ts - a.ts);
}
