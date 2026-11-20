// Shared helpers for the chart tools: reading/writing charts.js and talking to the Apple Music API.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chartsPath = join(root, 'charts.js');

export function readCharts() {
  if (!existsSync(chartsPath)) return {};
  const m = /window\.CHARTS = (\{[\s\S]*\});/.exec(readFileSync(chartsPath, 'utf8'));
  return m ? JSON.parse(m[1]) : {};
}

export function writeCharts(charts) {
  const body = Object.entries(charts)
    .map(([k, v]) => `  ${JSON.stringify(k)}: {\n    "meta": ${JSON.stringify(v.meta)},\n    "credit": ${JSON.stringify(v.credit)},\n    "offset": ${v.offset},\n    "notes": ${JSON.stringify(v.notes)}\n  }`)
    .join(',\n');
  writeFileSync(chartsPath, `// Song charts matched to Apple Music tracks: community charts (tools/import-rhythmplus.mjs)\n// and auto-charts (tools/autochart.mjs). Each chart is credited to its maker.\nwindow.CHARTS = {\n${body}\n};\n`);
}

// Apple Music API using the developer token in musickit-config.js.
export async function appleMusic(path) {
  const cfg = readFileSync(join(root, 'musickit-config.js'), 'utf8');
  const token = (/MUSICKIT_TOKEN = '([^']+)'/.exec(cfg) || [])[1];
  const r = await fetch('https://api.music.apple.com' + path, {
    headers: { Authorization: 'Bearer ' + token, Origin: 'http://localhost:8642' },
  });
  if (!r.ok) throw new Error('Apple Music API ' + r.status);
  return r.json();
}

// Best catalog match for a title/artist/length (seconds); returns [best, ...others].
export async function findSong(title, artist, length) {
  const res = await appleMusic(`/v1/catalog/us/search?types=songs&limit=15&term=${encodeURIComponent(artist + ' ' + title)}`);
  const songs = (res.results.songs && res.results.songs.data) || [];
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const score = (s) => (norm(s.attributes.name) === norm(title) ? 0 : 100)
    + (norm(s.attributes.artistName).includes(norm(artist)) ? 0 : 50)
    + Math.abs(s.attributes.durationInMillis / 1000 - length);
  return songs.sort((a, b) => score(a) - score(b));
}

export async function getSong(id) {
  return (await appleMusic(`/v1/catalog/us/songs/${id}`)).data[0];
}

export function chartMeta(song) {
  const a = song.attributes;
  return {
    id: 'am:' + song.id, catalogId: song.id, title: a.name, artist: a.artistName,
    art: a.artwork ? a.artwork.url.replace('{w}', 160).replace('{h}', 160) : '', duration: a.durationInMillis / 1000,
  };
}
