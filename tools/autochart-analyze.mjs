// Turns a song's audio (mono Float32Array) into a chart: finds the beat grid, finds where notes start,
// snaps them to the grid and thins them into three difficulty levels.
//
// Output notes are [time, [[lane, holdEnd or 0], ...], level]; level 0 = Easy (0.75x speed),
// 1 = Normal (1x), 2 = Hard (1.3x). Each level includes the notes of the levels below it.

const N = 1024; // FFT size (~46 ms: short enough to place onsets precisely)
const HOP = 256;

function fftSetup(n) {
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  return { rev, cos, sin };
}

function fft(re, im, { rev, cos, sin }) {
  const n = re.length;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step], s = sin[k * step];
        const a = i + k, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

const percentile = (arr, q) => {
  const s = Float64Array.from(arr).sort();
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

function movingMean(x, w) {
  const out = new Float32Array(x.length);
  let sum = 0, lo = 0, hi = -1;
  for (let i = 0; i < x.length; i++) {
    while (hi < Math.min(x.length - 1, i + w)) sum += x[++hi];
    while (lo < i - w) sum -= x[lo++];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

// Spectral flux in four bands (kick, bass/body, vocals/keys, cymbals), each scaled so no band dominates.
function features(x, sr) {
  const nFrames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  const bins = N / 2;
  const setup = fftSetup(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const band = (lo, hi) => [Math.ceil((lo * N) / sr), Math.min(bins - 1, Math.floor((hi * N) / sr))];
  const BANDS = [band(30, 150), band(150, 600), band(600, 3000), band(3000, 10000)];
  const WEIGHT = [1, 0.8, 1, 0.6];
  const pitchBand = band(100, 1500);
  const flux = BANDS.map(() => new Float32Array(nFrames));
  const rms = new Float32Array(nFrames);
  const pitch = new Float32Array(nFrames); // log2 of the strongest frequency in the melody range
  const re = new Float64Array(N), im = new Float64Array(N);
  let prev = new Float32Array(bins), cur = new Float32Array(bins);
  for (let f = 0; f < nFrames; f++) {
    const o = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) { const v = x[o + i]; e += v * v; re[i] = v * win[i]; im[i] = 0; }
    rms[f] = Math.sqrt(e / N);
    fft(re, im, setup);
    for (let b = 0; b < bins; b++) cur[b] = Math.log1p((1000 * Math.hypot(re[b], im[b])) / N);
    BANDS.forEach(([lo, hi], k) => {
      let s = 0;
      for (let b = lo; b <= hi; b++) { const d = cur[b] - prev[b]; if (d > 0) s += d; }
      flux[k][f] = f ? s : 0;
    });
    let best = pitchBand[0];
    for (let b = pitchBand[0]; b <= pitchBand[1]; b++) if (cur[b] > cur[best]) best = b;
    pitch[f] = Math.log2((best * sr) / N);
    [prev, cur] = [cur, prev];
  }
  const env = new Float32Array(nFrames);
  flux.forEach((fl, k) => {
    const scale = percentile(fl, 0.95) || 1;
    for (let f = 0; f < nFrames; f++) env[f] += (WEIGHT[k] * fl[f]) / scale;
  });
  const smooth = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) smooth[f] = (env[Math.max(0, f - 1)] + 2 * env[f] + env[Math.min(nFrames - 1, f + 1)]) / 4;
  return { env: smooth, rms, pitch, fps: sr / HOP, frameTime: (f) => (f * HOP + N / 2) / sr };
}

// Tempo from the autocorrelation of the onset envelope, favouring tempos near 120 BPM.
function estimatePeriod(e, fps) {
  const minLag = Math.floor((fps * 60) / 200), maxLag = Math.ceil((fps * 60) / 60);
  const ac = new Float64Array(maxLag + 2);
  for (let L = minLag - 1; L <= maxLag + 1; L++) {
    let s = 0;
    for (let t = 0; t + L < e.length; t++) s += e[t] * e[t + L];
    ac[L] = s / (e.length - L);
  }
  let best = minLag, bestScore = -Infinity;
  for (let L = minLag; L <= maxLag; L++) {
    const bpm = (60 * fps) / L;
    const score = ac[L] * Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
    if (score > bestScore) { bestScore = score; best = L; }
  }
  // a kick/snare pattern repeats every two beats, which can look like half the real tempo
  const half = Math.round(best / 2);
  if ((60 * fps) / best < 90 && half >= minLag && Math.max(ac[half - 1], ac[half], ac[half + 1]) > 0.5 * ac[best]) {
    best = half;
    for (const L of [half - 1, half + 1]) if (ac[L] > ac[best]) best = L;
  }
  const a = ac[best - 1], b = ac[best], c = ac[best + 1];
  const shift = a - 2 * b + c ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return best + Math.max(-0.5, Math.min(0.5, shift));
}

// Dynamic-programming beat tracker (Ellis 2007): beats land on strong onsets, roughly one period apart.
function trackBeats(e, P) {
  const n = e.length;
  let mean = 0, sq = 0;
  for (const v of e) { mean += v; sq += v * v; }
  mean /= n;
  const sd = Math.sqrt(Math.max(1e-12, sq / n - mean * mean));
  const local = Float64Array.from(e, (v) => v / sd);
  const cum = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const TIGHT = 100;
  for (let t = 0; t < n; t++) {
    let best = -Infinity, bi = -1;
    for (let p = Math.max(0, t - Math.round(2 * P)); p <= t - Math.round(P / 2); p++) {
      const s = cum[p] - TIGHT * Math.log((t - p) / P) ** 2;
      if (s > best) { best = s; bi = p; }
    }
    cum[t] = local[t] + (bi >= 0 ? Math.max(0, best) : 0);
    back[t] = best > 0 ? bi : -1;
  }
  let t = n - 1;
  for (let k = Math.max(0, n - 1 - Math.round(P)); k < n; k++) if (cum[k] > cum[t]) t = k;
  const beats = [];
  while (t >= 0) { beats.push(t); t = back[t]; }
  return beats.reverse();
}

export function analyze(x, sr) {
  const { env, rms, pitch, fps, frameTime } = features(x, sr);
  const n = env.length;
  if (n < fps * 5) throw new Error('Not enough audio to analyse.');
  const loud = percentile(rms, 0.9);
  const active = Uint8Array.from(movingMean(rms, Math.round(fps * 0.25)), (v) => v > loud * 0.05);
  const activeSec = active.reduce((s, v) => s + v, 0) / fps;

  // detrended envelope for tempo and beats
  const mean = movingMean(env, Math.round(fps * 0.5));
  const e = Float32Array.from(env, (v, i) => Math.max(0, v - mean[i]));
  const P = estimatePeriod(e, fps);
  const beatFrames = trackBeats(e, P).filter((f) => active[f]);
  const beats = beatFrames.map(frameTime);
  const bpm = beats.length > 1 ? 60 / ((beats[beats.length - 1] - beats[0]) / (beats.length - 1)) : (60 * fps) / P;

  // grid: each beat split into 16ths; sub 0 = beat, 1 = eighth, 2 = sixteenth
  const grid = [];
  for (let i = 0; i < beats.length; i++) {
    const gap = i + 1 < beats.length ? beats[i + 1] - beats[i] : 0;
    if (gap > 1.6 * (P / fps)) { grid.push({ t: beats[i], sub: 0, step: (P / fps) / 4 }); continue; } // a gap in the music
    for (let k = 0; k < (gap ? 4 : 1); k++) grid.push({ t: beats[i] + (k * gap) / 4, sub: k === 0 ? 0 : k === 2 ? 1 : 2, step: gap / 4 || (P / fps) / 4 });
  }

  // onset peaks, snapped to the nearest grid point
  const delta = 0.05 * (percentile(env, 0.95) || 1);
  const w = Math.max(1, Math.round(0.04 * fps));
  const amean = movingMean(env, Math.round(0.4 * fps));
  const cand = new Map();
  let g = 0;
  for (let f = 1; f < n - 1; f++) {
    if (!active[f] || env[f] <= amean[f] + delta) continue;
    let peak = true;
    for (let k = Math.max(0, f - w); k <= Math.min(n - 1, f + w) && peak; k++) if (env[k] > env[f]) peak = false;
    if (!peak) continue;
    const t = frameTime(f);
    while (g + 1 < grid.length && Math.abs(grid[g + 1].t - t) <= Math.abs(grid[g].t - t)) g++;
    const gp = grid[g];
    if (!gp || Math.abs(gp.t - t) > 0.45 * gp.step) continue;
    const str = env[f] - amean[f];
    const c = cand.get(g);
    if (!c || str > c.str) cand.set(g, { g, t: gp.t, sub: gp.sub, str, frame: f });
  }
  const cands = [...cand.values()].sort((a, b) => a.t - b.t);

  // score each onset against its neighbourhood, so quiet verses still get notes
  const METRIC = [1, 0.7, 0.45];
  for (let i = 0, lo = 0, hi = 0; i < cands.length; i++) {
    while (cands[lo].t < cands[i].t - 2) lo++;
    while (hi + 1 < cands.length && cands[hi + 1].t <= cands[i].t + 2) hi++;
    let m = 0;
    for (let k = lo; k <= hi; k++) m = Math.max(m, cands[k].str);
    cands[i].score = (cands[i].str / m) * METRIC[cands[i].sub];
  }

  // levels: Hard first, then Normal from Hard's notes, then Easy from Normal's
  const LEVELS = [
    { rate: 1.4, gap: 0.36, subs: [0, 1] },
    { rate: 2.2, gap: 0.22, subs: [0, 1, 2] },
    { rate: 3.2, gap: 0.13, subs: [0, 1, 2] },
  ];
  const pick = (pool, { rate, gap, subs }) => {
    const chosen = [];
    const target = Math.round(rate * activeSec);
    for (const c of [...pool].filter((c) => subs.includes(c.sub)).sort((a, b) => b.score - a.score)) {
      if (chosen.length >= target) break;
      if (chosen.some((o) => Math.abs(o.t - c.t) < gap - 1e-6)) continue;
      chosen.push(c);
    }
    return new Set(chosen);
  };
  const sets = [];
  sets[2] = pick(cands, LEVELS[2]);
  sets[1] = pick(sets[2], LEVELS[1]);
  sets[0] = pick(sets[1], LEVELS[0]);
  const notes = cands.filter((c) => sets[2].has(c));
  for (const c of notes) c.level = sets[0].has(c) ? 0 : sets[1].has(c) ? 1 : 2;

  // holds: a note followed by a stretch with no new notes while the sound keeps ringing
  for (let i = 0; i < notes.length; i++) {
    const c = notes[i];
    const next = i + 1 < notes.length ? notes[i + 1].t : c.t;
    c.end = 0;
    if (next - c.t < 0.6) continue;
    const f0 = c.frame + Math.round(0.05 * fps), f1 = Math.round((next - 0.1) * fps);
    let sum = 0, cnt = 0;
    for (let f = f0 + Math.round(0.05 * fps); f < Math.min(f1, n); f++) { sum += rms[f]; cnt++; }
    if (cnt && sum / cnt >= 0.6 * rms[Math.min(f0, n - 1)]) c.end = +Math.min(next - 0.1, c.t + 2.5).toFixed(3);
  }

  // lanes follow the melody: higher notes than their neighbours go further right
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    const c = notes[i];
    const p = pitch[Math.min(n - 1, c.frame + 2)];
    const near = notes.slice(Math.max(0, i - 8), i + 9).map((o) => pitch[Math.min(n - 1, o.frame + 2)]);
    const rank = near.filter((q) => q < p).length / Math.max(1, near.length - 1);
    const lane = Math.min(3, Math.floor(rank * 4));
    const alt = lane < 2 ? lane + 1 : lane - 1;
    out.push([+c.t.toFixed(3), [[lane, c.end], [alt, c.end]], c.level]);
  }
  const count = (l) => out.filter((o) => o[2] <= l).length;
  return { bpm, beats: beats.length, notes: out, levels: [count(0), count(1), count(2)], holds: notes.filter((c) => c.end).length, activeSec };
}
