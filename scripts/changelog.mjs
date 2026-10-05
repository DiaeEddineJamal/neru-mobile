// Writes CHANGELOG.md from src/changelog.json, the same source the in-app What's New uses.
// Run: node scripts/changelog.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const releases = JSON.parse(readFileSync(new URL('src/changelog.json', root), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('app.json', root), 'utf8')).expo;

if (releases[0]?.version !== pkg.version) {
  console.error(`app.json is ${pkg.version} but the newest changelog entry is ${releases[0]?.version}. Add an entry first.`);
  process.exit(1);
}

const md = ['# Neru mobile changelog', ''];
for (const r of releases) {
  md.push(`## ${r.version} · ${r.date}`, '', `**${r.title}.** ${r.summary}`, '');
  for (const i of r.items) md.push(`- **${i.title}.** ${i.text}`);
  md.push('');
}
writeFileSync(new URL('CHANGELOG.md', root), md.join('\n'));
console.log(`CHANGELOG.md updated (${releases.length} release${releases.length === 1 ? '' : 's'}).`);
