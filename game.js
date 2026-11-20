'use strict';
(function () {
  const LANES = 4;
  const ROWS = 4; // tile rows visible on screen
  const TILE_H = 0.5; // drawn height (in rows) of ordinary tiles; taps still count over the full row
  const HIT_ROW = 0.8; // the tap line sits this many rows above the bottom of the screen
  const KEY = 'starlightkeys.v1';
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const canvas = $('#game');
  const ctx = canvas.getContext('2d');

  // ---------- Storage ----------
  const store = {
    data: { best: {}, mode: 'relaxed', speed: 1, am: {} },
    load() {
      try {
        const d = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (d && typeof d === 'object') Object.assign(this.data, d);
      } catch (e) {}
    },
    save() {
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {}
    },
  };

  // ---------- Sound (synthesized piano, no files) ----------
  const Sound = {
    ctx: null,
    master: null,
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.7;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        // iOS: play even when the ringer/silent switch is on.
        try {
          if (navigator.audioSession) navigator.audioSession.type = 'playback';
          else silentLoop();
        } catch (e) {}
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    },
    note(midi, hold = false, vel = 1) {
      const c = this.ctx;
      if (!c) return { release() {} };
      const t = c.currentTime;
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      const out = c.createGain();
      const filt = c.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(Math.min(f * 9, 14000), t);
      filt.frequency.exponentialRampToValueAtTime(Math.max(f * 2.5, 500), t + 1.5);
      out.connect(filt); filt.connect(this.master);
      const decay = clamp(2.8 - (midi - 48) * 0.05, 0.8, 2.8);
      const peak = 0.3 * vel;
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(peak, t + 0.006);
      if (hold) out.gain.setTargetAtTime(peak * 0.4, t + 0.01, 0.3);
      else out.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      // [harmonic, amplitude]; 0.5 adds a soft octave-down for warmth
      const partials = [[1, 1], [2, 0.42], [3, 0.18], [4, 0.1], [5, 0.05], [0.5, 0.22]];
      const oscs = partials.map(([h, a]) => {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * h * (h > 1 ? 1 + 0.0003 * h * h : 1);
        const g = c.createGain();
        g.gain.value = a;
        o.connect(g); g.connect(out);
        o.start(t);
        return o;
      });
      const stopAt = (when) => oscs.forEach((o) => { try { o.stop(when); } catch (e) {} });
      if (!hold) stopAt(t + decay + 0.05);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          const n = c.currentTime;
          if (out.gain.cancelAndHoldAtTime) out.gain.cancelAndHoldAtTime(n);
          else { out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(peak * 0.4, n); }
          out.gain.setTargetAtTime(0.0001, n, 0.12);
          stopAt(n + 1);
        },
      };
    },
    oops() {
      const c = this.ctx;
      if (!c) return;
      const t = c.currentTime;
      [0, 0.12].forEach((d, i) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(i ? 330 : 392, t + d);
        o.frequency.exponentialRampToValueAtTime(i ? 220 : 300, t + d + 0.25);
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
        o.connect(g); g.connect(this.master);
        o.start(t + d); o.stop(t + d + 0.35);
      });
    },
    fanfare() {
      [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => setTimeout(() => this.note(m, false, 0.7), i * 90));
    },
  };

  function silentLoop() {
    const sr = 8000, n = sr / 2;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    const a = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
    a.loop = true;
    a.setAttribute('playsinline', '');
    a.play().catch(() => {});
  }

  // ---------- Songs -> tiles ----------
  const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function toMidi(name) {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
    if (!m) throw new Error('Bad note: ' + name);
    return (parseInt(m[3], 10) + 1) * 12 + NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }

  function rng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildChart(song) {
    const r = rng(song.id);
    const tiles = [];
    let beat = 0, prev = -1;
    for (const tok of song.notes.trim().split(/\s+/)) {
      const [n, d] = tok.split(':');
      const dur = d ? parseFloat(d) : 1;
      if (n !== 'R') {
        let lane;
        do { lane = Math.floor(r() * LANES); } while (lane === prev);
        prev = lane;
        const len = dur * song.rpb;
        tiles.push({ s: beat * song.rpb, len, lane, midi: toMidi(n), hold: len >= 2,
                     hit: false, hitAt: 0, prog: 0, voice: null, pid: null, off: 0, holdDone: false });
      }
      beat += dur;
    }
    return tiles;
  }

  // ---------- Layout ----------
  let W = 0, H = 0, DPR = 1, fieldX = 0, fieldW = 0, laneW = 0, rowH = 0, safeTop = 0;
  let sky = [];
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fieldW = W > H ? Math.min(W, H * 0.95) : W;
    fieldX = (W - fieldW) / 2;
    laneW = fieldW / LANES;
    rowH = H / ROWS;
    safeTop = parseFloat(getComputedStyle($('#safe')).paddingTop) || 0;
    const r = rng('sky');
    sky = [];
    const n = Math.round((W * H) / 7000);
    for (let i = 0; i < n; i++) sky.push({ x: r() * W, y: r() * H, s: r() * 1.6 + 0.4, p: r() * 6.28, sp: 0.5 + r() * 1.5 });
  }

  function rr(x, y, w, h, rad) {
    rad = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  // ---------- Game state ----------
  let G = null;
  let clock = 0;
  const KEYS = { d: 0, f: 1, j: 2, k: 3 };
  const KEY_NAMES = ['D', 'F', 'J', 'K'];
  const keyGlow = [0, 0, 0, 0];
  let usingKeys = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;

  function baseSpeed() {
    // rows per second
    return (G.song.bpm / 60) * G.song.rpb * G.mult * (G.relaxed ? 0.9 : 1);
  }

  function startSong(song) {
    Sound.unlock();
    const tiles = buildChart(song);
    G = {
      song, tiles, pos: tiles[0].s - HIT_ROW, started: false, score: 0, hits: 0, nextIdx: 0,
      state: 'play', t: 0, relaxed: store.data.mode === 'relaxed', mult: store.data.speed,
      particles: [], texts: [], flashes: [], fx: [], holding: new Set(), winAt: 0, endAt: 0, resumeT: 0,
      failTile: null, failTarget: 0,
    };
    showGameScreen();
  }

  // ---------- Apple Music songs: tiles follow the beat of the real track ----------
  const SPEED_RATE = { 0.75: 1.3, 1: 1.9, 1.3: 2.5 }; // target tiles per second

  function buildBeatChart(meta, speed) {
    const period = 60 / meta.bpm;
    const target = SPEED_RATE[speed] || 1.9;
    let step = 1;
    for (const c of [0.5, 1, 2, 4]) if (Math.abs(1 / (period * c) - target) < Math.abs(1 / (period * step) - target)) step = c;
    const rowSec = period * step; // seconds per tile row
    const rowsAt = (t) => (t - meta.offset) / rowSec;
    const r = rng(meta.id + ':' + speed);
    const tiles = [];
    let prev = -1;
    const last = rowsAt((meta.duration || 180) - 1.5);
    for (let k = Math.ceil(rowsAt(2.5)); k <= last; k++) {
      let lane;
      do { lane = Math.floor(r() * LANES); } while (lane === prev);
      prev = lane;
      const hold = k + 2 <= last && r() < 0.1;
      tiles.push({ s: k, len: hold ? 2 : 1, lane, midi: 0, hold, hit: false, hitAt: 0, prog: 0,
                   voice: null, pid: null, off: 0, holdDone: false, missed: false });
      if (hold) k++;
    }
    return { tiles, rowsAt };
  }

  // Community-made charts (charts.js) for Apple Music songs.
  const SCROLL_RATE = { 0.75: 1.8, 1: 2.4, 1.3: 3.0 }; // rows per second
  function chartFor(meta) { return (window.CHARTS || {})[meta.id] || null; }

  // Auto-charts tag each note with a difficulty level (third element); slower speeds get fewer tiles.
  const CHART_LEVEL = { 0.75: 0, 1: 1, 1.3: 2 };

  // One tile per moment: keep the chart's rhythm, but pick a single lane from each chord and end
  // holds before the next note, so it can always be played with one finger.
  function buildNoteChart(chart, speed, duration) {
    const rowSec = 1 / (SCROLL_RATE[speed] || 2.4);
    const rowsAt = (t) => t / rowSec;
    const level = CHART_LEVEL[speed] ?? 1;
    const notes = chart.notes.filter((n) => n[0] >= 0.2 && n[0] < duration - 0.5 && (n[2] || 0) <= level);
    const tiles = [];
    let prev = -1, prevT = -9;
    for (let i = 0; i < notes.length; i++) {
      const [t, keys] = notes[i];
      const nextT = i + 1 < notes.length ? notes[i + 1][0] : duration - 0.3;
      let pick = keys.find((k) => k[0] !== prev) || keys[0];
      // the same lane twice in quick succession would overlap; move it across
      if (pick[0] === prev && rowsAt(t - prevT) < 0.6) pick = [(prev + 2) % LANES, 0];
      const lane = pick[0];
      let end = pick[1] ? Math.min(pick[1], nextT - 0.08) : 0;
      const hold = end - t >= 0.35;
      const gapRows = rowsAt(nextT - t);
      const len = hold ? rowsAt(end - t) : clamp(gapRows * 0.9, 0.2, 0.5);
      tiles.push({ s: rowsAt(t), len, lane, midi: 0, hold, hit: false, hitAt: 0, prog: 0,
                   voice: null, pid: null, off: 0, holdDone: false, missed: false });
      prev = lane; prevT = t;
    }
    return { tiles, rowsAt };
  }

  async function startMusicSong(meta) {
    Sound.unlock();
    const chart = chartFor(meta);
    const { tiles, rowsAt } = chart
      ? buildNoteChart(chart, store.data.speed, meta.duration || chart.meta.duration)
      : buildBeatChart(meta, store.data.speed);
    if (!tiles.length) return;
    const song = { id: meta.id, title: meta.title, emoji: '🎧', hue: meta.hue, meta, credit: chart && chart.credit };
    G = {
      song, tiles, pos: rowsAt(0) - HIT_ROW, started: false, score: 0, hits: 0, nextIdx: 0,
      state: 'play', t: 0, relaxed: store.data.mode === 'relaxed', mult: 1,
      particles: [], texts: [], flashes: [], fx: [], holding: new Set(), winAt: 0, endAt: 0, resumeT: 0,
      failTile: null, failTarget: 0,
      music: { rowsAt, mt: 0, ready: false, requested: false, ended: false, error: '' },
    };
    showGameScreen();
    const g = G;
    try {
      await AM.player.prepare(meta);
      g.music.ready = true;
    } catch (e) {
      g.music.error = 'Couldn\u2019t load the song';
    }
  }

  function showGameScreen() {
    $('#menu').hidden = true;
    $('#amScreen').hidden = true;
    $('#result').hidden = true;
    $('#pause').hidden = true;
    $('#pauseBtn').hidden = false;
    requestWakeLock();
  }

  function replay() {
    const song = G.song;
    if (G.music) { AM.player.stop(); startMusicSong(song.meta); } else startSong(song);
  }

  function toMenu() {
    if (G && G.music) AM.player.stop();
    if (G) endAllHolds();
    G = null;
    $('#result').hidden = true;
    $('#pause').hidden = true;
    $('#pauseBtn').hidden = true;
    renderMenu();
    $('#amScreen').hidden = true;
    $('#calib').hidden = true;
    $('#menu').hidden = false;
    releaseWakeLock();
  }

  // Fraction of tiles needed for each star.
  function starMarks() { return G.music ? [0.3, 0.6, 0.9] : [1 / 3, 2 / 3, 1]; }
  function starsFor() {
    if (G.won && !G.music) return 3;
    const frac = G.hits / G.tiles.length;
    return starMarks().filter((m) => frac >= m - 1e-9).length;
  }

  function showResult() {
    const won = G.won;
    const stars = starsFor();
    const best = store.data.best[G.song.id] || { stars: 0, score: 0 };
    const newBest = G.score > best.score;
    store.data.best[G.song.id] = { stars: Math.max(best.stars, stars), score: Math.max(best.score, G.score) };
    store.save();
    $('#resTitle').textContent = won && G.music && stars < 2 ? pick(['Nice try!', 'Good job!', 'Keep going!']) : won ? pick(['Amazing!', 'You did it!', 'Super star!', 'Wonderful!']) : pick(['Oops!', 'So close!', 'Nice try!']);
    $('#resSong').textContent = G.song.emoji + ' ' + G.song.title;
    $('#resStars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
    $('#resScore').textContent = 'Score ' + G.score + (newBest && G.score > 0 ? '  ·  New best!' : '');
    $('#pauseBtn').hidden = true;
    $('#result').hidden = false;
  }

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function pause() {
    if (!G || G.state !== 'play') return;
    endAllHolds();
    G.state = 'paused';
    if (G.music) AM.player.pause();
    $('#retapBtn').hidden = !G.music || !!G.song.credit;
    $('#pauseSong').textContent = G.song.emoji + ' ' + G.song.title;
    $('#pause').hidden = false;
  }
  function resume() {
    if (!G || G.state !== 'paused') return;
    $('#pause').hidden = true;
    G.state = 'play';
    Sound.unlock();
    if (G.music) {
      // Rewind a little so there's time to get ready, then carry on.
      if (G.started) {
        const t = Math.max(0, G.music.mt - 2);
        G.music.mt = t;
        AM.player.seek(t).then(() => AM.player.play()).catch(() => {});
      }
      return;
    }
    if (G.started) G.resumeT = 1.2;
  }

  function endHold(t, complete) {
    if (t.holdDone) return;
    t.holdDone = true;
    if (t.voice) t.voice.release();
    t.voice = null; t.pid = null;
    G.holding.delete(t);
    const bonus = complete ? Math.round(t.len) : Math.round(t.prog * t.len * 0.5);
    if (bonus > 0) {
      G.score += bonus;
      const c = tileRect(t);
      G.texts.push({ x: c.x + c.w / 2, y: Math.min(H - 40, Math.max(80, c.y + c.h - t.prog * c.h)),
                     txt: complete ? '+' + bonus + ' ✨' : '+' + bonus, life: 1 });
    }
  }
  function endAllHolds() { if (G) [...G.holding].forEach((t) => endHold(t, false)); }

  function fail(tile, lane, row) {
    G.state = 'fail';
    G.endAt = G.t + 1.3;
    endAllHolds();
    if (G.music) AM.player.pause();
    Sound.oops();
    if (tile) {
      G.failTile = tile;
      G.failTarget = tile.s - 0.4;
    } else {
      G.failTarget = G.pos;
      G.flashes.push({ lane, row: Math.floor(row - G.pos) + G.pos, life: 1.3, red: true });
    }
    if (navigator.vibrate) navigator.vibrate(120);
  }

  function hitTile(t, pid, row) {
    t.hit = true;
    t.hitAt = G.t;
    G.hits++;
    G.score++;
    if (!G.started) G.started = true;
    if (t.hold) {
      t.pid = pid;
      // Fill starts where the finger is, but never outside the tile (taps can land just off it).
      t.off = clamp(row - G.pos, t.s - G.pos, t.s + t.len - G.pos - 0.5);
      if (!G.music) t.voice = Sound.note(t.midi, true);
      G.holding.add(t);
    } else if (!G.music) {
      Sound.note(t.midi);
    }
    const c = tileRect(t);
    const cy = t.hold ? clamp(H - t.off * rowH, c.y, c.y + c.h) : c.y + c.h / 2;
    burst(laneCenterX(t.lane, cy), cy, LANE_HUES[t.lane], t.hold ? 10 : 14, t.lane);
  }

  // Tap effects: a light beam up the lane, an expanding ring, and twinkling glitter.
  function burst(x, y, hue, n, lane) {
    G.fx.push({ kind: 'ring', x, y, hue, life: 0.45, max: 0.45 });
    if (lane != null) G.fx.push({ kind: 'beam', lane, hue, life: 0.35, max: 0.35 });
    for (let i = 0; i < n * 2; i++) {
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 340;
      const life = 0.5 + Math.random() * 0.7;
      G.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life, max: life, grav: 260, drag: 2.2,
                         hue: hue + (Math.random() * 50 - 25), size: 1.5 + Math.random() * 3.5,
                         kind: Math.random() < 0.4 ? 'glint' : 'dot', ph: Math.random() * 6.28 });
    }
  }

  function confetti() {
    for (let i = 0; i < 140; i++) {
      const life = 2.5 + Math.random();
      G.particles.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 120,
                         vy: 120 + Math.random() * 200, life, max: life, hue: Math.random() * 360,
                         size: 4 + Math.random() * 5, kind: Math.random() < 0.5 ? 'star' : 'glint', grav: 40, ph: Math.random() * 6.28 });
    }
  }

  // ---------- Perspective: lanes narrow toward the top of the screen ----------
  const PERSP_TOP = 0.58; // lane width at the top of the screen, relative to the bottom
  const LANE_HUES = [326, 188, 42, 268]; // pink, aqua, gold, violet

  function depth(y) { return PERSP_TOP + (1 - PERSP_TOP) * clamp(y / H, -0.2, 1.3); }
  function laneEdgeX(edge, y) {
    const cx = fieldX + fieldW / 2;
    return cx + (fieldX + edge * laneW - cx) * depth(y);
  }
  function laneCenterX(lane, y) { return (laneEdgeX(lane, y) + laneEdgeX(lane + 1, y)) / 2; }
  function screenToLane(x, y) {
    const cx = fieldX + fieldW / 2;
    const fx = cx + (x - cx) / depth(y);
    if (fx < fieldX || fx >= fieldX + fieldW) return -1;
    return clamp(Math.floor((fx - fieldX) / laneW), 0, LANES - 1);
  }

  // Hold tiles show their full length; ordinary tiles are drawn shorter, sitting on their beat.
  function visLen(t) { return t.hold ? t.len : Math.min(t.len, TILE_H); }

  function tileRect(t) {
    const yBottom = H - (t.s - G.pos) * rowH;
    const h = visLen(t) * rowH;
    const mid = yBottom - h / 2;
    const x = laneEdgeX(t.lane, mid);
    return { x, y: yBottom - h, w: laneEdgeX(t.lane + 1, mid) - x, h };
  }

  // ---------- Input ----------
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'touch') usingKeys = false;
    Sound.unlock();
    if (!G || G.state !== 'play' || G.resumeT > 0) return;
    if (G.music && !G.started) {
      // First tap starts the song (iOS only allows audio to start from a tap).
      if (G.music.ready && !G.music.requested) {
        G.music.requested = true;
        AM.player.play().catch(() => { G.music.requested = false; });
      }
      return;
    }
    const x = e.clientX, y = e.clientY;
    const lane = screenToLane(x, y);
    if (lane < 0) return;
    const row = G.pos + (H - y) / rowH;
    const tiles = G.tiles;
    let target = null;
    for (let i = G.nextIdx; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.s > G.pos + ROWS) break;
      if (t.hit || t.lane !== lane) continue;
      if (row >= t.s - 0.3 && row <= t.s + t.len + 0.3) { target = t; break; }
    }
    if (!target) {
      // Be generous: tapping anywhere in the right lane counts for the next tile.
      const n = tiles[G.nextIdx];
      if (n && n.lane === lane && n.s < G.pos + ROWS - 0.15) target = n;
    }
    if (!G.started) {
      if (target === tiles[0]) hitTile(target, e.pointerId, row);
      return;
    }
    if (target) hitTile(target, e.pointerId, row);
    else if (G.relaxed) G.flashes.push({ lane, row: Math.floor(row - G.pos) + G.pos, life: 0.35, red: false });
    else fail(null, lane, row);
  });

  function onUp(e) {
    if (!G) return;
    for (const t of G.holding) if (t.pid === e.pointerId) endHold(t, t.prog >= 0.9);
  }
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  // Block iOS zoom / scroll gestures on the game surface.
  ['gesturestart', 'gesturechange', 'dblclick'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- Update ----------
  function update(dt) {
    if (!G) return;
    G.t += dt;
    const tiles = G.tiles;

    if (G.music && G.state === 'play') {
      updateMusic(dt);
    } else if (G.state === 'play' && G.started) {
      if (G.resumeT > 0) {
        G.resumeT -= dt;
      } else {
        const progress = G.nextIdx / tiles.length;
        G.pos += baseSpeed() * (G.relaxed ? 1 : 1 + 0.2 * progress) * dt;
      }
      while (G.nextIdx < tiles.length && tiles[G.nextIdx].hit) G.nextIdx++;
      const next = tiles[G.nextIdx];
      if (next) {
        if (G.relaxed) G.pos = Math.min(G.pos, next.s - HIT_ROW);
        else if (next.s < G.pos - 0.08) fail(next);
      }
      for (const t of G.holding) {
        t.prog = clamp((G.pos + t.off - t.s) / t.len, 0, 1);
        if (t.prog >= 0.97) endHold(t, true);
      }
      if (G.state === 'play' && G.nextIdx >= tiles.length && G.holding.size === 0) {
        if (!G.winAt) G.winAt = G.t + 0.6;
        else if (G.t >= G.winAt) {
          G.state = 'win';
          G.won = true;
          G.endAt = G.t + 1.4;
          Sound.fanfare();
          confetti();
        }
      }
    }
    if (G.state === 'fail') {
      G.pos += (G.failTarget - G.pos) * Math.min(1, dt * 8);
      if (G.t >= G.endAt) { G.state = 'over'; showResult(); }
    } else if (G.state === 'win') {
      if (G.t >= G.endAt) { G.state = 'over'; showResult(); }
    }

    updateEffects(dt);
  }

  function updateMusic(dt) {
    const m = G.music, tiles = G.tiles, P = AM.player;
    if (P.isPlaying()) {
      if (!G.started) { G.started = true; m.mt = P.time(); }
      m.mt += dt;
      const pt = P.time();
      if (Math.abs(pt - m.mt) > 0.3) m.mt = pt;
      else m.mt += (pt - m.mt) * 0.1;
    }
    if (!G.started) return;
    G.pos = m.rowsAt(m.mt) - HIT_ROW; // a tile reaches the tap line on its beat
    while (G.nextIdx < tiles.length && (tiles[G.nextIdx].hit || tiles[G.nextIdx].missed)) G.nextIdx++;
    const next = tiles[G.nextIdx];
    if (next && next.s < G.pos - 0.08) {
      if (G.relaxed) { next.missed = true; next.hitAt = G.t; }
      else return fail(next);
    }
    for (const t of G.holding) {
      t.prog = clamp((G.pos + t.off - t.s) / t.len, 0, 1);
      if (t.prog >= 0.97) endHold(t, true);
    }
    const dur = P.duration() || G.song.meta.duration;
    if (m.ended || (dur && m.mt >= dur - 0.25) || (G.nextIdx >= tiles.length && !P.isPlaying())) {
      endAllHolds();
      G.state = 'win';
      G.won = true;
      G.endAt = G.t + 1.6;
      if (starsFor() > 0) confetti();
      P.stop();
    }
  }

  function updateEffects(dt) {
    for (const p of G.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.grav != null ? p.grav : 500) * dt;
      if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
      p.life -= dt;
    }
    for (const f of G.fx) f.life -= dt;
    G.fx = G.fx.filter((f) => f.life > 0);
    G.particles = G.particles.filter((p) => p.life > 0);
    for (const f of G.texts) { f.y -= 60 * dt; f.life -= dt; }
    G.texts = G.texts.filter((f) => f.life > 0);
    for (const f of G.flashes) f.life -= dt;
    G.flashes = G.flashes.filter((f) => f.life > 0);
  }

  // ---------- Draw ----------
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d0926');
    g.addColorStop(0.55, '#24164f');
    g.addColorStop(1, '#45206f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // soft nebula glows
    for (const [nx, ny, nr, col] of [[0.2, 0.25, 0.55, 'rgba(255,80,170,0.10)'], [0.85, 0.6, 0.6, 'rgba(90,120,255,0.10)']]) {
      const rg = ctx.createRadialGradient(W * nx, H * ny, 0, W * nx, H * ny, Math.max(W, H) * nr);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
    const drift = G ? G.pos * rowH * 0.12 : clock * 8;
    ctx.fillStyle = '#fff';
    for (const s of sky) {
      ctx.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(clock * s.sp + s.p));
      ctx.beginPath();
      ctx.arc(s.x, (s.y + drift) % H, s.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function lanePath(e0, e1, yTop, yBot) {
    ctx.beginPath();
    ctx.moveTo(laneEdgeX(e0, yTop), yTop);
    ctx.lineTo(laneEdgeX(e1, yTop), yTop);
    ctx.lineTo(laneEdgeX(e1, yBot), yBot);
    ctx.lineTo(laneEdgeX(e0, yBot), yBot);
    ctx.closePath();
  }

  function drawField() {
    // dark glass floor
    const fg = ctx.createLinearGradient(0, 0, 0, H);
    fg.addColorStop(0, 'rgba(6,3,20,0.15)');
    fg.addColorStop(1, 'rgba(6,3,20,0.55)');
    ctx.fillStyle = fg;
    lanePath(0, LANES, 0, H);
    ctx.fill();
    // a faint wash of each lane's colour, brighter toward the player
    for (let i = 0; i < LANES; i++) {
      const lg = ctx.createLinearGradient(0, 0, 0, H);
      lg.addColorStop(0, `hsla(${LANE_HUES[i]}, 90%, 60%, 0)`);
      lg.addColorStop(1, `hsla(${LANE_HUES[i]}, 90%, 60%, 0.10)`);
      ctx.fillStyle = lg;
      lanePath(i, i + 1, 0, H);
      ctx.fill();
    }
    // floor lines that scroll with the tiles, for a sense of speed and depth
    ctx.lineWidth = 1;
    for (let r = Math.floor(G.pos) - 1; r <= G.pos + ROWS + 1; r++) {
      const y = H - (r + 0.5 - G.pos) * rowH;
      if (y < 0 || y > H) continue;
      ctx.strokeStyle = `rgba(190,170,255,${0.03 + 0.12 * (y / H)})`;
      ctx.beginPath();
      ctx.moveTo(laneEdgeX(0, y), y);
      ctx.lineTo(laneEdgeX(LANES, y), y);
      ctx.stroke();
    }
    // lane dividers
    for (let i = 1; i < LANES; i++) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(255,255,255,0.02)');
      g.addColorStop(1, 'rgba(255,255,255,0.22)');
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(laneEdgeX(i, 0), 0);
      ctx.lineTo(laneEdgeX(i, H), H);
      ctx.stroke();
    }
    // glowing outer rails
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [e, hue] of [[0, LANE_HUES[0]], [LANES, LANE_HUES[3]]]) {
      for (const [lw, a] of [[10, 0.08], [4, 0.25], [1.5, 0.9]]) {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, `hsla(${hue}, 100%, 70%, 0)`);
        g.addColorStop(1, `hsla(${hue}, 100%, 70%, ${a})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(laneEdgeX(e, 0), 0);
        ctx.lineTo(laneEdgeX(e, H), H);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Trapezoid tile outline with rounded corners, following the lane's perspective.
  function tilePath(lane, yTop, yBot, inset, r) {
    const p = inset / laneW;
    const pts = [
      [laneEdgeX(lane + p, yTop), yTop], [laneEdgeX(lane + 1 - p, yTop), yTop],
      [laneEdgeX(lane + 1 - p, yBot), yBot], [laneEdgeX(lane + p, yBot), yBot],
    ];
    r = Math.max(0, Math.min(r, (yBot - yTop) / 2, (pts[1][0] - pts[0][0]) / 2));
    ctx.beginPath();
    ctx.moveTo((pts[3][0] + pts[0][0]) / 2, (pts[3][1] + pts[0][1]) / 2);
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      ctx.arcTo(a[0], a[1], b[0], b[1], r);
    }
    ctx.closePath();
    return pts;
  }

  // A glossy glass slab: drop shadow, visible thickness, glow, colour body, sheen, streaks and a bright rim.
  function drawGlassTile(lane, yTop, yBot, hue, opts = {}) {
    const d = depth(yBot);
    const thick = 18 * d;
    const r = 18 * d;
    const inset = 5;
    const sat = opts.sat == null ? 100 : opts.sat;
    ctx.save();
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    // drop shadow on the floor
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    tilePath(lane, yTop + thick + 8, yBot + thick + 8, inset + 2, r);
    ctx.fill();
    // outer glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `hsla(${hue}, 100%, 60%, 0.16)`;
    tilePath(lane, yTop - 6, yBot + 6, inset - 6, r + 6);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // thickness (the slab's front face, seen from slightly above)
    const side = ctx.createLinearGradient(0, yBot, 0, yBot + thick);
    side.addColorStop(0, `hsl(${hue}, 100%, 28%)`);
    side.addColorStop(1, `hsl(${hue}, 100%, 13%)`);
    ctx.fillStyle = side;
    tilePath(lane, yTop + thick, yBot + thick, inset, r);
    ctx.fill();
    // body
    const pts = tilePath(lane, yTop, yBot, inset, r);
    const body = ctx.createLinearGradient(0, yTop, 0, yBot);
    body.addColorStop(0, `hsl(${hue}, ${sat}%, 64%)`);
    body.addColorStop(0.5, `hsl(${hue}, ${sat}%, 52%)`);
    body.addColorStop(1, `hsl(${hue + 10}, ${sat}%, 40%)`);
    ctx.fillStyle = body;
    ctx.fill();
    // candy shading, clipped to the tile
    ctx.save();
    ctx.clip();
    const left = Math.min(pts[0][0], pts[3][0]), right = Math.max(pts[1][0], pts[2][0]);
    const w = right - left, h = yBot - yTop;
    // deep dome: bright centre falling off to dark, saturated edges
    const cx = left + w / 2, cy = yTop + h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, Math.max(1, h / w));
    const dome = ctx.createRadialGradient(0, -w * 0.12, 0, 0, 0, w * 0.72);
    dome.addColorStop(0, `hsla(${hue}, 100%, 82%, 0.45)`);
    dome.addColorStop(0.45, `hsla(${hue}, 100%, 60%, 0)`);
    dome.addColorStop(0.8, `hsla(${hue}, 100%, 25%, 0.35)`);
    dome.addColorStop(1, `hsla(${hue}, 100%, 14%, 0.8)`);
    ctx.fillStyle = dome;
    ctx.fillRect(-w, -w, w * 2, w * 2);
    ctx.restore();
    // extra shading down the sides and across the ends
    const sides = ctx.createLinearGradient(left, 0, right, 0);
    sides.addColorStop(0, `hsla(${hue}, 100%, 10%, 0.85)`);
    sides.addColorStop(0.1, `hsla(${hue}, 100%, 16%, 0.45)`);
    sides.addColorStop(0.3, `hsla(${hue}, 100%, 22%, 0)`);
    sides.addColorStop(0.7, `hsla(${hue}, 100%, 22%, 0)`);
    sides.addColorStop(0.9, `hsla(${hue}, 100%, 16%, 0.5)`);
    sides.addColorStop(1, `hsla(${hue}, 100%, 10%, 0.9)`);
    ctx.fillStyle = sides;
    ctx.fillRect(left, yTop, w, h);
    const endH = Math.min(h * 0.32, 40);
    const ends = ctx.createLinearGradient(0, yTop, 0, yBot);
    ends.addColorStop(0, `hsla(${hue}, 100%, 15%, 0.45)`);
    ends.addColorStop(endH / h, `hsla(${hue}, 100%, 15%, 0)`);
    ends.addColorStop(1 - endH / h, `hsla(${hue}, 100%, 15%, 0)`);
    ends.addColorStop(1, `hsla(${hue}, 100%, 10%, 0.6)`);
    ctx.fillStyle = ends;
    ctx.fillRect(left, yTop, w, h);
    // soft coloured glow rising from the bottom, like light through the candy
    const by = yBot - Math.min(h * 0.08, 12);
    ctx.save();
    ctx.translate(cx, by);
    ctx.scale(1, Math.min(h * 0.3, 50) / (w * 0.5));
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.5);
    bg.addColorStop(0, `hsla(${hue + 20}, 100%, 78%, 0.85)`);
    bg.addColorStop(1, `hsla(${hue + 20}, 100%, 70%, 0)`);
    ctx.fillStyle = bg;
    ctx.fillRect(-w * 0.5, -w * 0.5, w, w * 0.5);
    ctx.restore();
    // big glossy highlight across the top
    const hInset = w * 0.13;
    const hTop = yTop + Math.min(h * 0.06, 10);
    const hH = Math.min(h * 0.26, 46);
    const hy = hTop + hH * 0.4, hry = hH * 0.5;
    const hg = ctx.createLinearGradient(0, hTop, 0, hTop + hH);
    hg.addColorStop(0, 'rgba(255,255,255,0.92)');
    hg.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    hg.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.fillStyle = hg;
    rr(left + hInset, hTop, w - hInset * 2, hH, hH / 2);
    ctx.fill();
    // sparkle dot
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(left + hInset + hry * 0.9, hy, Math.max(3, Math.min(w * 0.045, hry * 0.5)), 0, Math.PI * 2);
    ctx.fill();
    // thin gloss stripe down the left side
    const sx = left + w * 0.12, sw = Math.max(2.5, w * 0.04);
    const sTop = hy + hry, sBot = yBot - Math.min(h * 0.28, 40);
    if (sBot - sTop > 10) {
      const stripe = ctx.createLinearGradient(0, sTop, 0, sBot);
      stripe.addColorStop(0, 'rgba(255,255,255,0.5)');
      stripe.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = stripe;
      rr(sx, sTop, sw, sBot - sTop, sw / 2);
      ctx.fill();
    }
    if (opts.fill) opts.fill(left, w);
    ctx.restore();
    // dark candy outline with a thin light inner rim
    tilePath(lane, yTop, yBot, inset, r);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = `hsl(${hue}, 90%, 16%)`;
    ctx.stroke();
    tilePath(lane, yTop + 3, yBot - 3, inset + 3, r - 3);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `hsla(${hue}, 100%, 88%, 0.55)`;
    ctx.stroke();
    ctx.restore();
  }

  function drawTile(t, isNext) {
    const yBot = H - (t.s - G.pos) * rowH;
    const yTop = yBot - visLen(t) * rowH;
    if (yTop > H + 20 || yBot < -20) return;
    const hue = LANE_HUES[t.lane];

    if (t.missed) {
      tilePath(t.lane, yTop, yBot, 5, 16 * depth(yBot));
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }
    if (t.hit && !t.hold) {
      // pop: the tile flashes white-hot and swells as it vanishes
      const a = 1 - (G.t - t.hitAt) / 0.28;
      if (a <= 0) return;
      const grow = (1 - a) * 14;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = `hsl(${hue}, 100%, 82%)`;
      tilePath(t.lane, yTop - grow, yBot + grow, 5 - grow, 18);
      ctx.fill();
      ctx.restore();
      return;
    }
    const failing = G.failTile === t;
    const blink = failing && Math.floor(G.t * 6) % 2 === 0;
    const holdFill = t.hold && t.hit && t.prog > 0
      ? (left, w) => {
        const fh = (yBot - yTop) * t.prog;
        const fg = ctx.createLinearGradient(0, yBot - fh, 0, yBot);
        fg.addColorStop(0, 'rgba(255,255,255,0.95)');
        fg.addColorStop(1, `hsla(${hue}, 100%, 80%, 0.8)`);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = fg;
        ctx.fillRect(left, yBot - fh, w, fh);
        ctx.globalCompositeOperation = 'source-over';
      }
      : null;
    drawGlassTile(t.lane, yTop, yBot, failing ? (blink ? 355 : 5) : hue, {
      alpha: t.hold && t.holdDone ? 0.45 : 1,
      fill: holdFill,
    });

    if (t.hold) {
      const xt = laneCenterX(t.lane, yTop + 26), xb = laneCenterX(t.lane, yBot - 30);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(xt, yTop + 26); ctx.lineTo(xb, yBot - 30); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(xb, yBot - 30, Math.min(14, laneW * 0.12) * depth(yBot), 0, Math.PI * 2); ctx.fill();
    }
    if (!G.started && t === G.tiles[0] && !G.music) {
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(Math.min(laneW * 0.26, 44))}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 6;
      const ty = yTop + Math.min((yBot - yTop) / 2, 70);
      ctx.fillText('TAP', laneCenterX(t.lane, ty), ty);
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    }
    if (isNext && G.relaxed && G.started && !t.hit) {
      const p = 0.5 + 0.5 * Math.sin(G.t * 6);
      tilePath(t.lane, yTop, yBot, 3, 18 * depth(yBot));
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + p * 0.55})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }

  // Glowing line showing where to tap; key letters appear on it when playing with a keyboard.
  function drawTapLine() {
    const y = H - HIT_ROW * rowH;
    const x0 = laneEdgeX(0, y), x1 = laneEdgeX(LANES, y);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < LANES; i++) {
      const hue = LANE_HUES[i];
      const glow = ctx.createLinearGradient(0, y - 30, 0, y + 30);
      glow.addColorStop(0, `hsla(${hue}, 100%, 60%, 0)`);
      glow.addColorStop(0.5, `hsla(${hue}, 100%, 60%, ${0.22 + (keyGlow[i] / 0.15) * 0.5})`);
      glow.addColorStop(1, `hsla(${hue}, 100%, 60%, 0)`);
      ctx.fillStyle = glow;
      lanePath(i, i + 1, y - 30, y + 30);
      ctx.fill();
    }
    const lg = ctx.createLinearGradient(x0, 0, x1, 0);
    LANE_HUES.forEach((h, i) => lg.addColorStop((i + 0.5) / LANES, `hsl(${h}, 100%, 72%)`));
    ctx.fillStyle = lg;
    ctx.fillRect(x0, y - 2, x1 - x0, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x0, y - 0.75, x1 - x0, 1.5);
    ctx.restore();
    if (usingKeys) {
      ctx.font = `800 ${Math.round(clamp(rowH * 0.16, 18, 30))}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      KEY_NAMES.forEach((k, i) => ctx.fillText(k, laneCenterX(i, y + 12), y + 12));
    }
  }

  function drawStar(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Four-pointed twinkle.
  function drawGlint(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x, y, x + s, y);
    ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fill();
  }

  function drawEffects() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of G.fx) {
      const k = f.life / f.max;
      if (f.kind === 'beam') {
        const yb = H - HIT_ROW * rowH + 30;
        const g = ctx.createLinearGradient(0, yb, 0, 0);
        g.addColorStop(0, `hsla(${f.hue}, 100%, 75%, ${0.45 * k})`);
        g.addColorStop(1, `hsla(${f.hue}, 100%, 75%, 0)`);
        ctx.fillStyle = g;
        lanePath(f.lane + 0.08, f.lane + 0.92, 0, yb);
        ctx.fill();
      } else if (f.kind === 'ring') {
        const rad = (1 - k) * laneW * 0.9 + 10;
        ctx.strokeStyle = `hsla(${f.hue}, 100%, 80%, ${k})`;
        ctx.lineWidth = 2 + 6 * k;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, rad, rad * 0.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (k > 0.6) {
          const core = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, laneW * 0.5);
          core.addColorStop(0, `rgba(255,255,255,${(k - 0.6) * 2})`);
          core.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = core;
          ctx.fillRect(f.x - laneW * 0.5, f.y - laneW * 0.5, laneW, laneW);
        }
      }
    }
    for (const p of G.particles) {
      const k = clamp(p.life / (p.max || 1), 0, 1);
      const twinkle = 0.55 + 0.45 * Math.sin(G.t * 28 + p.ph);
      ctx.globalAlpha = clamp(p.life * 2, 0, 1) * (p.kind === 'star' ? 1 : twinkle);
      ctx.fillStyle = p.kind === 'glint' ? `hsl(${p.hue}, 100%, ${80 + 20 * twinkle}%)` : `hsl(${p.hue}, 100%, 72%)`;
      if (p.kind === 'star') drawStar(p.x, p.y, p.size * 1.6);
      else if (p.kind === 'glint') drawGlint(p.x, p.y, p.size * (2.2 + 1.5 * k));
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }

  function drawHUD() {
    const top = safeTop + 18;
    // progress bar with 3 stars
    const bw = Math.min(fieldW * 0.55, 420), bx = W / 2 - bw / 2, by = top + 8, bh = 10;
    const frac = G.hits / G.tiles.length;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    rr(bx, by, bw, bh, bh / 2); ctx.fill();
    const pg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    pg.addColorStop(0, '#ff6fb5'); pg.addColorStop(1, '#ffd65a');
    ctx.fillStyle = pg;
    if (frac > 0) { rr(bx, by, Math.max(bh, bw * frac), bh, bh / 2); ctx.fill(); }
    starMarks().forEach((f) => {
      const lit = frac >= f - 1e-9;
      ctx.fillStyle = lit ? '#ffd65a' : 'rgba(255,255,255,0.3)';
      drawStar(bx + bw * f, by + bh / 2, lit ? 15 : 12);
    });
    // score
    ctx.font = `800 ${Math.round(clamp(H * 0.065, 40, 80))}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillText(G.score, W / 2 + 2, by + 26);
    ctx.fillStyle = '#fff';
    ctx.fillText(G.score, W / 2, by + 24);

    if (G.music && !G.started) {
      ctx.font = `800 ${Math.round(clamp(H * 0.05, 32, 64))}px ui-rounded, system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd65a';
      const msg = G.music.error || (!G.music.ready ? 'Loading song…' : G.music.requested ? 'Here it comes…' : '▶  Tap to start');
      ctx.fillText(msg, W / 2, H * 0.45);
      ctx.font = `600 ${Math.round(clamp(H * 0.025, 16, 26))}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(G.song.meta.title + (G.song.meta.artist ? ' · ' + G.song.meta.artist : ''), W / 2, H * 0.45 + 56);
      if (G.song.credit) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText(G.song.credit.text || `Chart by ${G.song.credit.author} on ${G.song.credit.source}`, W / 2, H * 0.45 + 92);
      }
    }
    if (G.resumeT > 0) {
      ctx.font = `800 ${Math.round(clamp(H * 0.08, 48, 96))}px ui-rounded, system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd65a';
      ctx.fillText('Ready…', W / 2, H * 0.45);
    }
  }

  function draw() {
    drawSky();
    if (!G) return;
    drawField();
    const tiles = G.tiles;
    const first = Math.max(0, G.nextIdx - 12);
    for (let i = first; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.s > G.pos + ROWS + 0.5) break;
      drawTile(t, i === G.nextIdx);
    }
    drawTapLine();
    for (const f of G.flashes) {
      const y = H - (f.row - G.pos + 1) * rowH;
      ctx.globalAlpha = clamp(f.life * 2, 0, 1) * (f.red ? 0.85 : 0.25);
      ctx.fillStyle = f.red ? '#ff4d6d' : '#fff';
      tilePath(f.lane, y + 4, y + rowH - 4, 4, 18 * depth(y + rowH));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawEffects();
    ctx.font = `800 32px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of G.texts) {
      ctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
      ctx.fillStyle = '#ffd65a';
      ctx.fillText(f.txt, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    drawHUD();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    for (let i = 0; i < LANES; i++) keyGlow[i] = Math.max(0, keyGlow[i] - dt);
    // Sample the song clock every frame so taps get an accurate, smoothed time.
    if (!$('#calib').hidden && AM.player.isPlaying()) AM.player.time();
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- Menu ----------
  function starHTML(n) {
    return [0, 1, 2].map((i) => `<span class="${i < n ? '' : 'off'}">★</span>`).join('');
  }
  function renderMenu() {
    const list = $('#songs');
    list.innerHTML = '';
    for (const song of window.SONGS) {
      const best = store.data.best[song.id] || { stars: 0, score: 0 };
      const b = document.createElement('button');
      b.className = 'song';
      b.style.setProperty('--h', song.hue);
      b.innerHTML = `<div class="em">${song.emoji}</div><div class="info"><div class="name"></div>
        <div class="meta"><span>${'🎵'.repeat(song.level)}</span><span class="stars">${starHTML(best.stars)}</span></div></div>`;
      b.querySelector('.name').textContent = song.title;
      b.addEventListener('click', () => startSong(song));
      list.appendChild(b);
    }
    for (const btn of document.querySelectorAll('#modeSeg button')) btn.classList.toggle('on', btn.dataset.v === store.data.mode);
    for (const btn of document.querySelectorAll('#speedSeg button')) btn.classList.toggle('on', parseFloat(btn.dataset.v) === store.data.speed);
    renderAmSongs();
    $('#modeHint').textContent = store.data.mode === 'relaxed'
      ? 'Tiles wait for you — no mistakes!'
      : 'Tap every tile before it falls off — and don’t tap the empty spaces!';
  }
  $('#modeSeg').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) { store.data.mode = v; store.save(); renderMenu(); }
  });
  $('#speedSeg').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) { store.data.speed = parseFloat(v); store.save(); renderMenu(); }
  });

  // ---------- Apple Music screens ----------
  function hueFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return h;
  }

  function songCard(meta, cls) {
    const b = document.createElement('button');
    b.className = cls;
    b.style.setProperty('--h', meta.hue);
    const art = meta.art ? document.createElement('img') : document.createElement('div');
    if (meta.art) { art.src = meta.art; art.alt = ''; } else { art.className = 'em'; art.textContent = '🎧'; }
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<div class="name"></div><div class="artist"></div>';
    info.querySelector('.name').textContent = meta.title;
    info.querySelector('.artist').textContent = meta.artist;
    b.append(art, info);
    return b;
  }

  function renderAmSongs() {
    const sec = $('#amSection');
    sec.hidden = !AM.available();
    if (sec.hidden) return;
    const list = $('#amSongs');
    list.innerHTML = '';
    const songs = Object.values(store.data.am).sort((a, b) => (b.added || 0) - (a.added || 0));
    for (const c of Object.values(window.CHARTS || {})) {
      if (!store.data.am[c.meta.id]) songs.push(Object.assign({ hue: hueFor(c.meta.id) }, c.meta));
    }
    for (const meta of songs) {
      const b = songCard(meta, 'song');
      const best = store.data.best[meta.id] || { stars: 0 };
      const st = document.createElement('div');
      st.className = 'meta';
      st.innerHTML = `<span>${chartFor(meta) ? '🎼 Chart' : ''}</span><span class="stars">${starHTML(best.stars)}</span>`;
      b.querySelector('.info').appendChild(st);
      b.addEventListener('click', () => playAmSong(meta));
      list.appendChild(b);
    }
  }

  function playAmSong(meta) {
    if (meta.bpm || chartFor(meta)) startMusicSong(meta);
    else calibrate(meta);
  }

  let amWhere = 'library';
  let searchSeq = 0;
  const setAmStatus = (t) => { $('#amStatus').textContent = t; };

  function renderAmWhere() {
    for (const btn of document.querySelectorAll('#amWhere button')) btn.classList.toggle('on', btn.dataset.v === amWhere);
  }

  async function openAm() {
    $('#amScreen').hidden = false;
    $('#amResults').innerHTML = '';
    renderAmWhere();
    setAmStatus('Connecting to Apple Music…');
    try {
      await AM.load();
      if (AM.isAuthorized()) setAmStatus('Type a song name above.');
      else showSignIn();
    } catch (e) {
      setAmStatus((e && e.message) || 'Could not reach Apple Music.');
    }
  }

  function showSignIn() {
    setAmStatus('Sign in once so the game can play your music.');
    $('#amResults').innerHTML = '<button class="btn primary" id="amSignIn" style="display:block;margin:20px auto">Sign in to Apple Music</button>';
    $('#amSignIn').addEventListener('click', async () => {
      try {
        await AM.authorize();
        $('#amResults').innerHTML = '';
        setAmStatus('Type a song name above.');
        if ($('#amSearch').value.trim()) doSearch();
      } catch (e) {
        setAmStatus('Sign-in didn’t finish. Try again?');
      }
    });
  }

  async function doSearch() {
    const term = $('#amSearch').value.trim();
    if (!term) return;
    if (!AM.isAuthorized()) { showSignIn(); return; }
    const seq = ++searchSeq;
    setAmStatus('Searching…');
    try {
      const res = amWhere === 'library' ? await AM.searchLibrary(term) : await AM.searchCatalog(term);
      if (seq !== searchSeq) return;
      const list = $('#amResults');
      list.innerHTML = '';
      for (const meta of res) {
        meta.hue = hueFor(meta.id);
        const b = songCard(meta, 'result');
        if (store.data.am[meta.id]) b.querySelector('.artist').textContent += '  ·  ✓ added';
        b.addEventListener('click', () => chooseAmSong(meta));
        list.appendChild(b);
      }
      setAmStatus(res.length ? '' : amWhere === 'library'
        ? 'Not found in your library. Try “All of Apple Music”.' : 'No songs found.');
    } catch (e) {
      if (seq === searchSeq) setAmStatus('Search didn’t work: ' + ((e && e.message) || e));
    }
  }

  function chooseAmSong(meta) {
    $('#amSearch').blur();
    const saved = store.data.am[meta.id];
    const m = Object.assign({}, meta, saved ? { bpm: saved.bpm, offset: saved.offset } : {}, { added: Date.now() });
    store.data.am[m.id] = m;
    store.save();
    $('#amScreen').hidden = true;
    playAmSong(m);
  }

  // Beat calibration: a grown-up taps along once; we fit a straight line through the taps.
  function fitBeat(taps) {
    const ts = taps.slice(-24);
    if (ts.length < 8) return null;
    const gaps = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
    const m = gaps[Math.floor(gaps.length / 2)];
    if (!(m > 0.25 && m < 2)) return null;
    const xs = ts.map((t) => Math.round((t - ts[0]) / m));
    const n = ts.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ts.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ts[i] - my); sxx += (xs[i] - mx) ** 2; }
    if (!sxx) return null;
    const period = sxy / sxx, phase = my - period * mx;
    let err = 0;
    for (let i = 0; i < n; i++) err += (ts[i] - (phase + period * xs[i])) ** 2;
    err = Math.sqrt(err / n);
    return { bpm: 60 / period, offset: ((phase % period) + period) % period, err };
  }

  const cal = { meta: null, taps: [], fit: null };

  async function calibrate(meta) {
    if (G && G.music) AM.player.stop();
    G = null;
    cal.meta = meta; cal.taps = []; cal.fit = null;
    for (const id of ['#menu', '#amScreen', '#pause', '#result', '#pauseBtn', '#calTap', '#calDone']) $(id).hidden = true;
    $('#calSong').textContent = meta.title + (meta.artist ? ' · ' + meta.artist : '');
    $('#calHelp').textContent = 'Grown-up step: press play, then tap a steady beat, like clapping along or tapping your foot. Just the beat, not every note. You only do this once per song.';
    $('#calBpm').textContent = '';
    const play = $('#calPlay');
    play.hidden = false; play.disabled = true; play.textContent = 'Loading…';
    $('#calib').hidden = false;
    try {
      await AM.player.prepare(meta);
      play.disabled = false;
      play.textContent = '▶ Play the song';
    } catch (e) {
      play.textContent = 'Couldn’t load this song';
    }
  }

  $('#calPlay').addEventListener('click', async () => {
    Sound.unlock();
    try { await AM.player.play(); } catch (e) { $('#calBpm').textContent = 'Couldn’t play this song.'; return; }
    $('#calPlay').hidden = true;
    $('#calTap').hidden = false;
    $('#calBpm').textContent = 'Tap along with the beat…';
  });
  $('#calTap').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!AM.player.isPlaying()) return;
    cal.taps.push(AM.player.time());
    const btn = $('#calTap');
    btn.classList.add('pulse');
    setTimeout(() => btn.classList.remove('pulse'), 90);
    const f = fitBeat(cal.taps);
    const good = f && f.err < 0.06;
    if (good) cal.fit = f;
    $('#calBpm').textContent = good ? `Got it! About ${Math.round(f.bpm)} beats per minute ✓`
      : cal.taps.length < 8 ? `Keep tapping… ${cal.taps.length}` : 'Keep tapping, nice and steady…';
    $('#calDone').hidden = !cal.fit;
  });
  $('#calDone').addEventListener('click', () => {
    AM.player.stop();
    const m = Object.assign(cal.meta, { bpm: cal.fit.bpm, offset: cal.fit.offset });
    const d = AM.player.duration();
    if (d > 0) m.duration = d;
    store.data.am[m.id] = m;
    store.save();
    $('#calib').hidden = true;
    startMusicSong(m);
  });
  $('#calCancel').addEventListener('click', () => {
    AM.player.stop();
    toMenu();
  });

  $('#amOpen').addEventListener('click', openAm);
  $('#amBack').addEventListener('click', () => { searchSeq++; toMenu(); });
  $('#amWhere').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) { amWhere = v; renderAmWhere(); doSearch(); }
  });
  let searchTimer = 0;
  $('#amSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 500); });
  $('#amSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(); $('#amSearch').blur(); } });
  $('#retapBtn').addEventListener('click', () => calibrate(G.song.meta));
  AM.player.onEnded(() => { if (G && G.music) G.music.ended = true; });

  $('#pauseBtn').addEventListener('click', pause);
  $('#resumeBtn').addEventListener('click', resume);
  $('#restartBtn').addEventListener('click', replay);
  $('#quitBtn').addEventListener('click', toMenu);
  $('#againBtn').addEventListener('click', replay);
  $('#menuBtn').addEventListener('click', toMenu);
  document.addEventListener('pointerdown', () => Sound.unlock(), { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else if (G && G.state === 'play') requestWakeLock();
  });

  // Keep the screen awake while playing.
  let wakeLock = null;
  function requestWakeLock() {
    try { navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {}); } catch (e) {}
  }
  function releaseWakeLock() {
    try { wakeLock?.release(); } catch (e) {}
    wakeLock = null;
  }

  // Keyboard controls for computers: D F J K play the four lanes, Space taps the beat, Esc pauses.
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.matches && e.target.matches('input, textarea')) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') { if (G?.state === 'play') pause(); else if (G?.state === 'paused') resume(); return; }
    const lane = KEYS[key];
    if (!$('#calib').hidden) {
      if ((key === ' ' || lane != null) && !e.repeat && !$('#calTap').hidden) {
        e.preventDefault();
        $('#calTap').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      }
      return;
    }
    if (lane == null || e.repeat || !G) return;
    e.preventDefault();
    usingKeys = true;
    keyGlow[lane] = 0.15;
    // Aim at the first unplayed tile on screen in this lane; otherwise press on the tap line.
    let row = G.pos + HIT_ROW;
    for (let i = G.nextIdx; i < G.tiles.length; i++) {
      const t = G.tiles[i];
      if (t.s > G.pos + ROWS) break;
      if (!t.hit && !t.missed && t.lane === lane) { row = t.s + 0.1; break; }
    }
    const cy = H - (row - G.pos) * rowH;
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: laneCenterX(lane, cy), clientY: cy, pointerId: 100 + lane, bubbles: true,
    }));
  });
  window.addEventListener('keyup', (e) => {
    const lane = KEYS[e.key.toLowerCase()];
    if (lane != null) onUp({ pointerId: 100 + lane });
  });

  if (location.search.includes('debug')) { window.__G = () => G; window.__fitBeat = fitBeat; }

  window.addEventListener('resize', resize);
  store.load();
  resize();
  renderMenu();
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
