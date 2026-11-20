#!/usr/bin/env node
// Makes a chart for an Apple Music song by listening to it while it plays in the Music app.
//
// Usage:
//   node tools/autochart.mjs [--device "Loopback Audio"] [--offset SECONDS] [--am APPLE_CATALOG_ID] [--dry]
//
// Setup: in Loopback, make a virtual device whose only source is Music (so other sounds stay out).
// Run this, then play the song in Music from the beginning and let it finish. The audio is analysed
// in memory and thrown away; only the tile timings are written to charts.js.
//
// --device  Loopback device name (default "Loopback Audio")
// --offset  shift every note by this many seconds (positive = later) if the chart feels early/late
// --am      use this Apple Music catalog song ID instead of searching for the playing song
// --dry     analyse and print a summary without changing charts.js
import { spawn } from 'node:child_process';
import { analyze } from './autochart-analyze.mjs';
import { readCharts, writeCharts, findSong, getSong, chartMeta } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const device = opt('device') || 'Loopback Audio';
const offset = Number(opt('offset') || 0);
const SR = 22050;

// ---------- capture: raw samples from the Loopback device, kept in memory ----------
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-i', ':' + device,
  '-af', 'pan=mono|c0=0.5*c0+0.5*c1', '-ar', String(SR), '-f', 'f32le', 'pipe:1']);
const chunks = [];
let bytes = 0;
let t0 = Infinity; // wall-clock time of the first captured sample
ff.stdout.on('data', (b) => {
  chunks.push(b);
  bytes += b.length;
  t0 = Math.min(t0, Date.now() - (bytes / 4 / SR) * 1000);
});
let ffErr = '';
ff.stderr.on('data', (d) => { ffErr += d; });
ff.on('exit', (code) => {
  if (state !== 'done') fail(`Could not record from "${device}".${ffErr ? '\n' + ffErr.trim() : ''}\n` +
    'Check the device name, and that your terminal has microphone access (System Settings > Privacy & Security).');
});

// ---------- the Music app's playback position, polled 10 times a second ----------
const JXA = `
const M = Application('Music');
while (true) {
  const o = { s: 'stopped' };
  try {
    o.s = M.playerState();
    if (o.s !== 'stopped') {
      const a = Date.now(); o.p = M.playerPosition(); o.w = (a + Date.now()) / 2;
      const t = M.currentTrack(); o.n = t.name(); o.a = t.artist(); o.d = t.duration();
    }
  } catch (e) { o.err = String(e); }
  if (!o.w) o.w = Date.now();
  console.log(JSON.stringify(o));
  delay(0.1);
}`;
const osa = spawn('osascript', ['-l', 'JavaScript', '-e', JXA]);
let line = '';
osa.stderr.on('data', (d) => {
  line += d;
  let i;
  while ((i = line.indexOf('\n')) >= 0) {
    const s = line.slice(0, i); line = line.slice(i + 1);
    try { onPoll(JSON.parse(s)); } catch (e) { if (!/^\s*$/.test(s)) console.error(s); }
  }
});

let state = 'waiting';
let track = null;
const polls = [];
let said = '';
const say = (s) => { if (s !== said) { process.stdout.write('\n' + s + '\n'); said = s; } };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function onPoll(o) {
  if (state === 'waiting') {
    if (o.s === 'playing' && o.p < 3 && bytes > 0) {
      track = { name: o.n, artist: o.a, duration: o.d };
      state = 'listening';
      say(`Listening to "${o.n}" by ${o.a}. Let it play to the end (don't pause or skip).`);
    } else if (o.s === 'playing') say('Restart the song from the beginning (⏮) in Music.');
    else say(`Ready. Play the song in Music from the beginning. (Listening on "${device}")`);
    return;
  }
  if (state !== 'listening') return;
  const last = polls[polls.length - 1];
  if (o.n !== track.name || (o.s === 'stopped' && last && last.p > track.duration - 2)) return finish();
  if (o.s !== 'playing') {
    if (last && last.p > track.duration - 2) return finish();
    return fail('\nPlayback paused or stopped before the end. Run the tool again and let the song play through.');
  }
  if (last && Math.abs((o.p - last.p) - (o.w - last.w) / 1000) > 0.7) {
    return fail('\nThe song jumped (skipped or scrubbed). Run the tool again and let it play through.');
  }
  polls.push({ p: o.p, w: o.w });
  process.stdout.write(`\r  ${clock(o.p)} / ${clock(track.duration)}  `);
  if (o.p >= track.duration - 0.3) finish();
}

function stopAll() {
  state = 'done';
  ff.kill('SIGINT');
  osa.kill();
}
function fail(msg) { stopAll(); console.error(msg); process.exit(1); }
process.on('SIGINT', () => fail('\nStopped.'));

async function finish() {
  stopAll();
  if (polls.length < 20) fail('Not enough of the song was heard.');
  // Where the song started in the recording: median of (capture time - song position) over every poll.
  const shifts = polls.map((q) => (q.w - t0) / 1000 - q.p).sort((a, b) => a - b);
  const shift = shifts[shifts.length >> 1];
  const spread = (shifts[Math.floor(shifts.length * 0.9)] - shifts[Math.floor(shifts.length * 0.1)]) * 1000;

  const all = Buffer.concat(chunks);
  const raw = new Float32Array(all.buffer.slice(all.byteOffset, all.byteOffset + (all.length & ~3)));
  const from = Math.max(0, Math.round(shift * SR));
  const audio = raw.subarray(from, Math.min(raw.length, from + Math.round(track.duration * SR)));
  let peak = 0;
  for (const v of audio) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-3) fail(`\nHeard silence on "${device}". In Loopback, make sure Music is a source of that device.`);

  console.log('\n\nAnalysing…');
  const r = analyze(audio, SR);
  const notes = r.notes.map(([t, keys, lvl]) => [+(t + offset).toFixed(3), keys.map(([l, e]) => [l, e ? +(e + offset).toFixed(3) : 0]), lvl]);
  console.log(`  Tempo ${r.bpm.toFixed(1)} BPM, ${r.beats} beats`);
  console.log(`  Tiles: Easy ${r.levels[0]}, Normal ${r.levels[1]}, Hard ${r.levels[2]} (${r.holds} holds)`);
  console.log(`  Sync with Music: song start at ${shift.toFixed(3)}s into the recording (polls agree within ${spread.toFixed(0)} ms)`);

  let song;
  try {
    song = opt('am') ? await getSong(opt('am')) : (await findSong(track.name, track.artist, track.duration))[0];
  } catch (e) { fail('Apple Music lookup failed: ' + e.message); }
  if (!song) fail('No Apple Music match found; pass --am CATALOG_ID.');
  const meta = chartMeta(song);
  console.log(`  Matched to Apple Music: ${meta.title} - ${meta.artist} (${meta.catalogId}), ${meta.duration.toFixed(2)}s vs ${track.duration.toFixed(2)}s in Music`);
  if (Math.abs(meta.duration - track.duration) > 1.5) console.log('  ⚠ Lengths differ: this may be a different version of the song. Check, or pass --am.');

  if (args.includes('--dry')) { console.log('\n--dry: charts.js not changed.'); process.exit(0); }
  const charts = readCharts();
  const old = charts[meta.id];
  if (old && old.credit && old.credit.source !== 'Starlight Keys') {
    console.log(`  Replacing the chart by ${old.credit.author} on ${old.credit.source}.`);
  }
  charts[meta.id] = {
    meta,
    credit: { author: 'auto-charter', chart: `${r.bpm.toFixed(0)} BPM`, source: 'Starlight Keys', text: 'Auto-charted from the song' },
    offset,
    notes,
  };
  writeCharts(charts);
  console.log(`\nSaved to charts.js. Play it in the game; if tiles feel early or late, re-run with --offset (e.g. --offset 0.05).`);
  process.exit(0);
}
