'use strict';
(function () {
  const LANES = 4;
  const ROWS = 4; // tile rows visible on screen
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
      particles: [], texts: [], flashes: [], holding: new Set(), winAt: 0, endAt: 0, resumeT: 0,
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

  async function startMusicSong(meta) {
    Sound.unlock();
    const { tiles, rowsAt } = buildBeatChart(meta, store.data.speed);
    if (!tiles.length) return;
    const song = { id: meta.id, title: meta.title, emoji: '🎧', hue: meta.hue, meta };
    G = {
      song, tiles, pos: rowsAt(0) - HIT_ROW, started: false, score: 0, hits: 0, nextIdx: 0,
      state: 'play', t: 0, relaxed: store.data.mode === 'relaxed', mult: 1,
      particles: [], texts: [], flashes: [], holding: new Set(), winAt: 0, endAt: 0, resumeT: 0,
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
    $('#retapBtn').hidden = !G.music;
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
    burst(c.x + c.w / 2, cy, G.song.hue, t.hold ? 10 : 14);
  }

  function burst(x, y, hue, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 260;
      G.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.6 + Math.random() * 0.4,
                         hue: hue + (Math.random() * 60 - 30), size: 2 + Math.random() * 4, star: Math.random() < 0.3 });
    }
  }

  function confetti() {
    for (let i = 0; i < 120; i++) {
      G.particles.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 120,
                         vy: 120 + Math.random() * 200, life: 2.5 + Math.random(), hue: Math.random() * 360,
                         size: 4 + Math.random() * 5, star: Math.random() < 0.5, grav: 40 });
    }
  }

  function tileRect(t) {
    const yBottom = H - (t.s - G.pos) * rowH;
    const h = t.len * rowH;
    return { x: fieldX + t.lane * laneW, y: yBottom - h, w: laneW, h };
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
    if (x < fieldX || x >= fieldX + fieldW) return;
    const lane = clamp(Math.floor((x - fieldX) / laneW), 0, LANES - 1);
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
      p.life -= dt;
    }
    G.particles = G.particles.filter((p) => p.life > 0);
    for (const f of G.texts) { f.y -= 60 * dt; f.life -= dt; }
    G.texts = G.texts.filter((f) => f.life > 0);
    for (const f of G.flashes) f.life -= dt;
    G.flashes = G.flashes.filter((f) => f.life > 0);
  }

  // ---------- Draw ----------
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#140f33');
    g.addColorStop(0.6, '#2b1a5c');
    g.addColorStop(1, '#4a2378');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
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

  function drawField() {
    if (W > H) {
      ctx.fillStyle = 'rgba(8, 5, 25, 0.35)';
      ctx.fillRect(fieldX, 0, fieldW, H);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    for (let i = W > H ? 0 : 1; i <= (W > H ? LANES : LANES - 1); i++) {
      const x = Math.round(fieldX + i * laneW) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }

  function drawTile(t, isNext) {
    const c = tileRect(t);
    if (c.y > H || c.y + c.h < 0) return;
    const pad = Math.max(3, laneW * 0.03);
    const x = c.x + pad, y = c.y + pad, w = c.w - pad * 2, h = c.h - pad * 2;
    const rad = Math.min(22, laneW * 0.14);
    const hue = G.song.hue;

    if (t.missed) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#fff';
      rr(x, y, w, h, rad);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    if (t.hit && !t.hold) {
      const a = 1 - (G.t - t.hitAt) / 0.3;
      if (a <= 0) return;
      const grow = (1 - a) * 8;
      ctx.globalAlpha = a * 0.7;
      ctx.fillStyle = `hsl(${hue}, 100%, 88%)`;
      rr(x - grow, y - grow, w + grow * 2, h + grow * 2, rad);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    const failing = G.failTile === t;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    if (failing) {
      const blink = Math.floor(G.t * 6) % 2 === 0;
      g.addColorStop(0, blink ? '#ff5d6c' : '#ff9aa4');
      g.addColorStop(1, blink ? '#c9203a' : '#ff5d6c');
    } else {
      g.addColorStop(0, `hsl(${hue}, 90%, 66%)`);
      g.addColorStop(1, `hsl(${hue + 28}, 85%, 48%)`);
    }
    // glow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = `hsl(${hue}, 100%, 70%)`;
    rr(x - 4, y - 4, w + 8, h + 8, rad + 4);
    ctx.fill();
    ctx.globalAlpha = t.hold && t.holdDone ? 0.45 : 1;
    ctx.fillStyle = g;
    rr(x, y, w, h, rad);
    ctx.fill();
    // shine
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    rr(x + w * 0.1, y + 6, w * 0.8, Math.min(h * 0.22, 26), rad * 0.6);
    ctx.fill();

    if (t.hold) {
      const cx = x + w / 2;
      if (t.hit && t.prog > 0) {
        const fh = h * t.prog;
        const fg = ctx.createLinearGradient(0, y + h - fh, 0, y + h);
        fg.addColorStop(0, 'rgba(255,255,255,0.95)');
        fg.addColorStop(1, `hsla(${hue}, 100%, 85%, 0.9)`);
        ctx.fillStyle = fg;
        ctx.save();
        rr(x, y, w, h, rad);
        ctx.clip();
        ctx.fillRect(x, y + h - fh, w, fh);
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, y + 26); ctx.lineTo(cx, y + h - 30); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx, y + h - 30, Math.min(14, w * 0.12), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (!G.started && t === G.tiles[0] && !G.music) {
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(Math.min(w * 0.28, 44))}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TAP', x + w / 2, y + Math.min(h / 2, 70));
    }
    if (isNext && G.relaxed && G.started && !t.hit) {
      const p = 0.5 + 0.5 * Math.sin(G.t * 6);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + p * 0.5})`;
      ctx.lineWidth = 4;
      rr(x, y, w, h, rad);
      ctx.stroke();
    }
  }

  // Glowing line showing where to tap; key letters appear on it when playing with a keyboard.
  function drawTapLine() {
    const y = H - HIT_ROW * rowH;
    const glow = ctx.createLinearGradient(0, y - 26, 0, y + 26);
    glow.addColorStop(0, 'rgba(255,111,181,0)');
    glow.addColorStop(0.5, 'rgba(255,111,181,0.28)');
    glow.addColorStop(1, 'rgba(255,111,181,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(fieldX, y - 26, fieldW, 52);
    for (let i = 0; i < LANES; i++) {
      const k = keyGlow[i];
      if (k > 0) {
        ctx.globalAlpha = k / 0.15 * 0.35;
        ctx.fillStyle = '#fff';
        rr(fieldX + i * laneW + 6, y - 30, laneW - 12, 60, 18);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    const lg = ctx.createLinearGradient(fieldX, 0, fieldX + fieldW, 0);
    lg.addColorStop(0, '#ff6fb5'); lg.addColorStop(0.5, '#ffd65a'); lg.addColorStop(1, '#7b6cff');
    ctx.fillStyle = lg;
    ctx.fillRect(fieldX, y - 2, fieldW, 4);
    if (usingKeys) {
      ctx.font = `800 ${Math.round(clamp(rowH * 0.16, 18, 30))}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      KEY_NAMES.forEach((k, i) => ctx.fillText(k, fieldX + (i + 0.5) * laneW, y + 12));
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
      rr(fieldX + f.lane * laneW + 4, y + 4, laneW - 8, rowH - 8, 18);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of G.particles) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = `hsl(${p.hue}, 100%, 75%)`;
      if (p.star) drawStar(p.x, p.y, p.size * 1.6);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
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
    for (const meta of songs) {
      const b = songCard(meta, 'song');
      const best = store.data.best[meta.id] || { stars: 0 };
      const st = document.createElement('div');
      st.className = 'meta';
      st.innerHTML = `<span></span><span class="stars">${starHTML(best.stars)}</span>`;
      b.querySelector('.info').appendChild(st);
      b.addEventListener('click', () => playAmSong(meta));
      list.appendChild(b);
    }
  }

  function playAmSong(meta) {
    if (meta.bpm) startMusicSong(meta);
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
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: fieldX + (lane + 0.5) * laneW, clientY: H - (row - G.pos) * rowH, pointerId: 100 + lane, bubbles: true,
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
