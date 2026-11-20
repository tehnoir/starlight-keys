#!/usr/bin/env node
// Imports a Rhythm Plus chart from a HAR capture of its game page and matches it to an Apple Music song.
//
// Usage:
//   node tools/import-rhythmplus.mjs path/to/capture.har [--am APPLE_CATALOG_ID] [--offset SECONDS]
//
// How to capture: open the song's rhythm-plus.com/game/... page in Chrome with DevTools > Network open,
// let it load, then right-click the request list > "Save all as HAR". Keep HAR files out of git: they can
// contain your login cookies (*.har is in .gitignore).
//
// --am      use this Apple Music catalog song ID instead of searching for the best match
// --offset  shift every note by this many seconds (positive = later) if the chart feels early/late
import { readFileSync } from 'node:fs';
import { readCharts, writeCharts, findSong, getSong, chartMeta } from './lib.mjs';

const args = process.argv.slice(2);
const harPath = args.find((a) => !a.startsWith('--') && !/^-?\d/.test(a) && a.endsWith('.har'));
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
if (!harPath) {
  console.error('Usage: node tools/import-rhythmplus.mjs capture.har [--am APPLE_CATALOG_ID] [--offset SECONDS]');
  process.exit(1);
}

// Only the chart and song-info API responses are read from the HAR; headers/cookies are ignored.
const har = JSON.parse(readFileSync(harPath, 'utf8'));
const apiJson = (path) => {
  for (const e of har.log.entries) {
    if (e.request.method !== 'GET' || !e.request.url.split('?')[0].endsWith(path)) continue;
    const c = e.response.content || {};
    if (!c.text) continue;
    return JSON.parse(c.encoding === 'base64' ? Buffer.from(c.text, 'base64').toString('utf8') : c.text);
  }
  return null;
};
const sheet = apiJson('/api/v1/sheet/get');
const song = apiJson('/api/v1/song/get');
if (!sheet || !sheet.mapping) {
  console.error('No Rhythm Plus chart found in that HAR. Make sure the game page fully loaded while recording.');
  process.exit(1);
}
const map = JSON.parse(sheet.mapping);
const LANE = { d: 0, f: 1, j: 2, k: 3 };
const offset = Number(opt('offset') || 0);
// Each note is [time, [[lane, holdEnd or 0], ...]]; most moments are chords of several keys.
const notes = [];
for (const m of map.mappings) {
  const keys = [];
  for (const k of m.k) {
    const lane = LANE[k];
    if (lane == null) continue; // only 4-key charts are supported
    const end = m.h && m.h[k] != null ? +(m.h[k] + offset).toFixed(3) : 0;
    keys.push([lane, end && end - m.t >= 0.3 ? end : 0]);
  }
  if (keys.length) notes.push([+(m.t + offset).toFixed(3), keys]);
}
notes.sort((a, b) => a[0] - b[0]);
const title = (song && song.title) || sheet.title;
const artist = (song && song.artist) || '';
const length = sheet.length || map.length || 0;

let pick;
if (opt('am')) {
  pick = await getSong(opt('am'));
} else {
  const songs = await findSong(title, artist, length);
  pick = songs[0];
  console.log('Apple Music matches (best first):');
  for (const s of songs.slice(0, 5)) {
    console.log(`  ${s.id}  ${s.attributes.name} - ${s.attributes.artistName}  (${(s.attributes.durationInMillis / 1000).toFixed(1)}s)`);
  }
}
if (!pick) { console.error('No Apple Music match found; pass --am CATALOG_ID.'); process.exit(1); }
const a = pick.attributes;
const amLength = a.durationInMillis / 1000;

const charts = readCharts();
const id = 'am:' + pick.id;
charts[id] = {
  meta: chartMeta(pick),
  credit: { author: (song && song.creatorName) || 'unknown', chart: sheet.title, source: 'Rhythm Plus', url: `https://rhythm-plus.com/game/${sheet.id}` },
  offset,
  notes,
};
writeCharts(charts);
console.log(`\nImported "${sheet.title}" by ${charts[id].credit.author}: ${notes.length} moments, ${notes.reduce((n, x) => n + x[1].length, 0)} notes`);
console.log(`Matched to Apple Music: ${a.name} - ${a.artistName} (${pick.id})`);
console.log(`Length: chart ${length.toFixed(2)}s vs Apple Music ${amLength.toFixed(2)}s (difference ${(amLength - length).toFixed(2)}s)`);
