'use strict';
// Apple Music (MusicKit JS v3) wrapper, plus a fake "mock" backend for testing (add ?mock to the URL).
// Apple's script is only loaded when the Apple Music screen is opened, so the rest of the game
// never talks to anything outside this site.
(function () {
  const MOCK = /[?&]mock\b/.test(location.search);
  let mk = null;
  let loading = null;
  const endedHandlers = [];

  function artUrl(art, size) {
    return art && art.url ? art.url.replace('{w}', size).replace('{h}', size) : '';
  }

  function toMeta(item, catalogId) {
    const a = item.attributes || {};
    return {
      id: 'am:' + catalogId,
      catalogId,
      title: a.name || 'Unknown song',
      artist: a.artistName || '',
      art: artUrl(a.artwork, 160),
      duration: (a.durationInMillis || 0) / 1000,
      explicit: a.contentRating === 'explicit',
    };
  }

  // Smoothed playback clock: MusicKit only updates currentPlaybackTime a few times a second.
  const clock = { raw: -1, at: 0 };
  function smoothTime(raw, playing) {
    const now = performance.now();
    if (raw !== clock.raw) { clock.raw = raw; clock.at = now; }
    return playing ? raw + Math.min(1, (now - clock.at) / 1000) : raw;
  }

  const real = {
    available: () => !!window.MUSICKIT_TOKEN,
    load() {
      if (mk) return Promise.resolve(mk);
      if (loading) return loading;
      loading = new Promise((resolve, reject) => {
        const ready = async () => {
          try {
            await window.MusicKit.configure({
              developerToken: window.MUSICKIT_TOKEN,
              app: { name: 'Starlight Keys', build: '1.0.0' },
            });
            mk = window.MusicKit.getInstance();
            mk.addEventListener('playbackTimeDidChange', () => smoothTime(mk.currentPlaybackTime || 0, mk.isPlaying));
            mk.addEventListener('playbackStateDidChange', () => {
              const S = window.MusicKit.PlaybackStates || {};
              if (mk.playbackState === S.ended || mk.playbackState === S.completed) endedHandlers.forEach((f) => f());
            });
            resolve(mk);
          } catch (e) { loading = null; reject(e); }
        };
        if (window.MusicKit) { ready(); return; }
        document.addEventListener('musickitloaded', ready, { once: true });
        const s = document.createElement('script');
        s.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
        s.async = true;
        s.onerror = () => { loading = null; reject(new Error('Could not reach Apple Music. Are you online?')); };
        document.head.appendChild(s);
      });
      return loading;
    },
    isAuthorized: () => !!(mk && mk.isAuthorized),
    async authorize() { await real.load(); await mk.authorize(); return mk.isAuthorized; },
    async searchCatalog(term) {
      await real.load();
      const r = await mk.api.music(`/v1/catalog/${mk.storefrontId || 'us'}/search`, { term, types: 'songs', limit: 25 });
      const songs = (r.data && r.data.results && r.data.results.songs && r.data.results.songs.data) || [];
      return songs.map((s) => toMeta(s, s.id)).filter((m) => !m.explicit);
    },
    async searchLibrary(term) {
      await real.load();
      const r = await mk.api.music('/v1/me/library/search', { term, types: 'library-songs', limit: 25 });
      const songs = (r.data && r.data.results && r.data.results['library-songs'] && r.data.results['library-songs'].data) || [];
      const out = [];
      for (const s of songs) {
        let cat = s.attributes && s.attributes.playParams && s.attributes.playParams.catalogId;
        if (!cat) {
          // Library IDs don't play reliably in MusicKit v3; look up the matching catalog song.
          try {
            const c = await mk.api.music(`/v1/me/library/songs/${s.id}/catalog`);
            cat = c.data && c.data.data && c.data.data[0] && c.data.data[0].id;
          } catch (e) {}
        }
        const meta = cat && toMeta(s, cat);
        if (meta && !meta.explicit) out.push(meta);
      }
      return out;
    },
    player: {
      async prepare(meta) {
        await real.load();
        await mk.setQueue({ song: meta.catalogId, startPlaying: false });
        clock.raw = -1;
      },
      async play() { await mk.play(); },
      pause() { try { mk && mk.pause(); } catch (e) {} },
      stop() { try { mk && mk.stop(); } catch (e) {} },
      async seek(t) { await mk.seekToTime(Math.max(0, t)); clock.raw = -1; },
      isPlaying() { return !!(mk && mk.isPlaying); },
      time() { return mk ? smoothTime(mk.currentPlaybackTime || 0, mk.isPlaying) : 0; },
      duration() { return (mk && mk.currentPlaybackDuration) || 0; },
      onEnded(f) { endedHandlers.push(f); },
    },
  };

  // ---------- Mock backend (testing only): a silent clock pretending to be a 120 BPM song ----------
  const mockState = { playing: false, base: 0, startedAt: 0, dur: 40 };
  const mockTime = () => mockState.base + (mockState.playing ? (performance.now() - mockState.startedAt) / 1000 : 0);
  const mock = {
    available: () => true,
    load: () => Promise.resolve(),
    isAuthorized: () => true,
    authorize: async () => true,
    async searchCatalog(term) {
      return [{ id: 'am:mock120', catalogId: 'mock120', title: 'Test Beat (' + term + ')', artist: 'Metronome', art: '', duration: 40 }];
    },
    async searchLibrary(term) { return mock.searchCatalog(term); },
    player: {
      async prepare(meta) { mockState.playing = false; mockState.base = 0; mockState.dur = meta.duration || 40; },
      async play() { if (!mockState.playing) { mockState.startedAt = performance.now(); mockState.playing = true; } },
      pause() { mockState.base = mockTime(); mockState.playing = false; },
      stop() { mockState.playing = false; mockState.base = 0; },
      async seek(t) { mockState.base = Math.max(0, t); mockState.startedAt = performance.now(); },
      isPlaying: () => mockState.playing,
      time() {
        const t = mockTime();
        if (mockState.playing && t >= mockState.dur) { mockState.playing = false; mockState.base = mockState.dur; endedHandlers.forEach((f) => f()); }
        const q = parseFloat((/[?&]mockq=([\d.]+)/.exec(location.search) || [])[1]);
        const shown = Math.min(t, mockState.dur);
        return q ? smoothTime(Math.floor(shown / q) * q, mockState.playing) : shown;
      },
      duration: () => mockState.dur,
      onEnded(f) { endedHandlers.push(f); },
    },
  };

  window.AM = MOCK ? mock : real;
})();
