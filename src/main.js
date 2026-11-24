import '@fontsource-variable/inter/opsz.css'; // includes Inter Display: more compact at large sizes
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/dm-serif-display/400.css';
import '@fontsource/dm-serif-display/400-italic.css';
import { icons, $, $$, esc, fmt, toast, greeting, clamp, eqBars } from './util.js';
import { loadSettings, saveSettings, applyTheme, extractPalette, artBrightness, PRESETS, DEFAULTS, supportsRefraction } from './theme.js';
import { initFX, paintMelt } from './fx.js';
import { initLens } from './lens.js';
import { DemoPlayer, SpotifyPlayer } from './player.js';
import { LyricsView, getLyrics } from './lyrics.js';
import { Spotify, normTrack, bestImage, playlistEntryTrack } from './api.js';
import { handleCallback, isLoggedIn, login, logout, getClientId, setClientId, redirectUri, redirectLooksValid } from './auth.js';
import { demoTracks, demoPlaylists } from './demo.js';
import { isNative, NATIVE_REDIRECT, onAppUrl, closeBrowser, onBackButton, onResume, minimize, setStatusBar, openSpotifyApp, haptic, showNowPlaying, hideNowPlaying, onNowPlayingAction } from './native.js';

if (isNative) document.documentElement.classList.add('native');

const PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#3a3a44'/><stop offset='1' stop-color='#16161a'/></linearGradient></defs><rect width='100' height='100' fill='url(#g)'/><path d='M42 66V38l22-5v26' fill='none' stroke='#fff' stroke-opacity='.45' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/><circle cx='37' cy='66' r='6' fill='#fff' fill-opacity='.45'/><circle cx='59' cy='60' r='6' fill='#fff' fill-opacity='.45'/></svg>`,
  );

const S = {
  settings: loadSettings(),
  palette: null,
  player: null,
  me: null,
  trackId: undefined,
  saved: false,
  demoSaved: new Set(),
  queue: [],
  playlists: [],
  recent: [],
  collection: null,
  searchTracks: [],
  query: '',
  chip: 'all',
  context: 'Spotifier',
  muteFrom: 0.7,
};
const isDemo = () => S.player?.mode !== 'spotify';
const view = $('#view');

// ---------- icons ----------
function hydrateIcons(root = document) {
  for (const el of $$('[data-icon]', root)) {
    if (el.dataset.iconDone) continue;
    el.insertAdjacentHTML('afterbegin', icons[el.dataset.icon] || '');
    el.dataset.iconDone = '1';
  }
}

// ---------- theme & effects ----------
const fx = initFX(S.settings);
function theme() {
  const { aurora } = applyTheme(S.settings, S.palette);
  fx.setColors(aurora);
  fx.configure(S.settings);
  setStatusBar(S.settings.mode);
}

// ---------- lyrics ----------
const immersiveOpen = () => document.body.classList.contains('imm-open');
const playerOpen = () => document.body.classList.contains('player-open');
function onLyricLine(v, i) {
  fx.pulse(0.3);
  const visible = v === lyImm ? immersiveOpen() : playerOpen() && !immersiveOpen();
  const node = v.nodes[i];
  if (visible && node) {
    const r = node.getBoundingClientRect();
    fx.burst(r.left + r.width / 2, r.top + r.height / 2, 3);
  }
}
const lyMain = new LyricsView($('#lyrics-main'), { onSeek: (ms) => S.player.seek(ms), onLine: (i) => onLyricLine(lyMain, i) });
const lyImm = new LyricsView($('#lyrics-imm'), { onSeek: (ms) => S.player.seek(ms), onLine: (i) => onLyricLine(lyImm, i) });

let lyricsReq = 0;
async function loadLyrics(t) {
  const my = ++lyricsReq;
  const views = [lyMain, lyImm];
  const status = (html) => views.forEach((v) => v.status(html));
  if (!t) return status('<p class="big-note">Lyrics appear here</p><p>Play a song and the words float in as glass bubbles.</p>');
  status('<div class="loader"><i></i><i></i><i></i></div>');
  try {
    const r = await getLyrics(t);
    if (my !== lyricsReq) return;
    if (r.instrumental) status('<p class="big-note">Instrumental</p><p>No words on this one.</p>');
    else if (!r.lines.length) status('<p class="big-note">No lyrics found</p><p>The free lyrics library (LRCLIB) doesn’t have this song yet.</p>');
    else views.forEach((v) => v.set(r));
  } catch {
    if (my === lyricsReq) status('<p class="big-note">Lyrics are offline</p><p>Couldn’t reach the lyrics service.</p>');
  }
}

// ---------- sliders ----------
const ranges = [];
function makeRange(el, { onInput, onCommit, kind }) {
  const r = { el, kind, dragging: false };
  let rect;
  const val = (e) => clamp((e.clientX - rect.left) / rect.width, 0, 1);
  el.addEventListener('pointerdown', (e) => {
    rect = el.getBoundingClientRect();
    r.dragging = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const v = val(e);
    el.style.setProperty('--p', v);
    onInput?.(v);
  });
  el.addEventListener('pointermove', (e) => {
    if (!r.dragging) return;
    const v = val(e);
    el.style.setProperty('--p', v);
    onInput?.(v);
  });
  const end = (e) => {
    if (!r.dragging) return;
    r.dragging = false;
    el.classList.remove('drag');
    onCommit?.(val(e));
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => {
    r.dragging = false;
    el.classList.remove('drag');
  });
  el.addEventListener('keydown', (e) => {
    const cur = Number(getComputedStyle(el).getPropertyValue('--p')) || 0;
    const d = ['ArrowRight', 'ArrowUp'].includes(e.key) ? 0.05 : ['ArrowLeft', 'ArrowDown'].includes(e.key) ? -0.05 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const v = clamp(cur + d, 0, 1);
    el.style.setProperty('--p', v);
    onCommit?.(v);
  });
  ranges.push(r);
  return r;
}
for (const el of $$('.progress'))
  makeRange(el, {
    kind: 'seek',
    onInput: (v) => ($('.t-pos').textContent = fmt(v * S.player.state.duration)),
    onCommit: (v) => S.player.seek(v * S.player.state.duration),
  });
makeRange($('.volume'), { kind: 'volume', onInput: (v) => S.player.setVolume(v), onCommit: (v) => S.player.setVolume(v) });

// ---------- player wiring ----------
function wirePlayer(p) {
  S.player = p;
  p.addEventListener('change', onPlayerChange);
  p.addEventListener('error', (e) => toast(e.detail, 'error', 6500));
  p.addEventListener('ready', () => toast(isNative ? 'Ready to play right here in Spotifier.' : 'Browser player connected. Pick a song to play here.', 'ok'));
  onPlayerChange();
}

const shown = {}; // what the UI currently shows, so we only touch the DOM on real changes
function changed(key, value) {
  if (shown[key] === value) return false;
  shown[key] = value;
  return true;
}

function onPlayerChange() {
  const s = S.player.state;
  const t = s.track;
  if ((t?.id ?? null) !== S.trackId) {
    S.trackId = t?.id ?? null;
    onTrack(t);
  }
  if (changed('paused', s.paused)) {
    for (const b of $$('.play-toggle')) {
      b.innerHTML = s.paused ? icons.play : icons.pause;
      b.setAttribute('aria-label', s.paused ? 'Play' : 'Pause');
    }
  }
  document.documentElement.classList.toggle('is-playing', !s.paused && !!t);
  if (changed('shuffle', s.shuffle)) $$('[data-act="shuffle"]').forEach((b) => b.classList.toggle('on', s.shuffle));
  if (changed('repeat', s.repeat))
    $$('[data-act="repeat"]').forEach((b) => {
      b.classList.toggle('on', s.repeat !== 'off');
      b.innerHTML = s.repeat === 'track' ? icons.repeatOne : icons.repeat;
    });
  const vol = ranges.find((r) => r.kind === 'volume');
  if (!vol.dragging && changed('volume', s.volume)) vol.el.style.setProperty('--p', s.volume);
  if (changed('muted', s.volume === 0)) $$('[data-act="mute"]').forEach((b) => (b.innerHTML = s.volume === 0 ? icons.mute : icons.volume));
  const remote = S.player.remote;
  const line = s.device
    ? `<span class="dot"></span>Playing on <b>${esc(s.device)}</b>${remote && S.player.deviceId ? ' · <button class="text-btn" data-act="play-here">Play here</button>' : ''}`
    : '';
  if (changed('device', line)) $('.device-line').innerHTML = line;
  syncNowPlaying();
}

// Android: while music plays inside Spotifier, show the "now playing" notification
// (it also keeps the app alive in the background). Hidden after 5 minutes on pause.
let pausedAt = 0;
function syncNowPlaying() {
  if (!isNative || !S.player) return;
  const s = S.player.state;
  if (!S.player.sdkActive || !s.track) return hideNowPlaying();
  if (s.paused) {
    pausedAt ||= Date.now();
    if (Date.now() - pausedAt > 5 * 60_000) return hideNowPlaying();
  } else pausedAt = 0;
  showNowPlaying({ title: s.track.name, artist: s.track.artists, playing: !s.paused });
}
setInterval(syncNowPlaying, 30_000);
onNowPlayingAction((a) => {
  if (a === 'toggle') S.player?.toggle();
  else if (a === 'next') S.player?.next();
  else if (a === 'prev') S.player?.prev();
});

async function onTrack(t) {
  const art = t?.image || PLACEHOLDER;
  const newArt = changed('art', art);
  if (newArt) {
    $$('.np-art').forEach((img) => (img.src = art));
    $$('.art-melt canvas.melt').forEach((cv) => paintMelt(cv, t?.image));
    fx.setArt(t?.image || '');
  }
  $$('.np-title').forEach((el) => {
    el.textContent = t?.name || 'Nothing playing';
    el.dataset.text = el.textContent;
  });
  $$('.np-artist').forEach((el) => (el.textContent = t ? t.artists : 'Pick something from your library'));
  $$('.np-name').forEach((el) => (el.textContent = t?.name || 'Nothing playing'));
  $$('.np-artist-small').forEach((el) => (el.textContent = t?.artists || 'Pick a song to start'));
  const off = lyricOffset(t);
  lyMain.setOffset(off);
  lyImm.setOffset(off);
  if (t && S.sleep?.endOfSong && S.sleep.track && S.sleep.track !== t.id) {
    S.sleep = null;
    if (!S.player.state.paused) S.player.toggle();
    toast('Sleep timer: paused at the end of the song');
  }
  $('.np-context').textContent = S.context;
  document.title = t ? `${t.name} · ${t.artists}` : 'Spotifier';
  if (newArt)
    $$('.art-frame').forEach((f) => {
      f.classList.remove('swap');
      void f.offsetWidth;
      f.classList.add('swap');
    });
  markPlayingRows();
  fx.pulse(1);
  loadLyrics(t);
  refreshQueue();
  checkSaved();
  if (newArt) artBrightness(t?.image).then((b) => t?.id === S.trackId && document.documentElement.classList.toggle('art-bright', b > 0.6));
  const pal = t?.image ? await extractPalette(t.image) : null;
  if (t?.id === S.trackId) {
    S.palette = pal;
    theme();
  }
}

function markPlayingRows() {
  $$('[data-tid]').forEach((row) => row.classList.toggle('playing', row.dataset.tid === S.trackId));
}

// ---------- save / share / device ----------
async function checkSaved() {
  const t = S.player.state.track;
  S.saved = false;
  if (t && isDemo()) S.saved = S.demoSaved.has(t.id);
  else if (t?.uri?.startsWith('spotify:')) {
    try {
      S.saved = !!(await Spotify.isSaved(t.uri));
    } catch {
      /* ignore */
    }
  }
  renderSaved();
}
function renderSaved() {
  $$('[data-act="save"]').forEach((b) => {
    b.classList.toggle('on', S.saved);
    b.innerHTML = S.saved ? icons.heart : icons.heartOutline;
    b.setAttribute('aria-label', S.saved ? 'Remove from Liked Songs' : 'Save to Liked Songs');
  });
}

async function toggleSave() {
  const t = S.player.state.track;
  if (!t) return toast('Play something first.');
  const next = !S.saved;
  if (isDemo()) next ? S.demoSaved.add(t.id) : S.demoSaved.delete(t.id);
  else {
    try {
      await Spotify.setSaved(t.uri, next);
    } catch (e) {
      return toast(e.status === 403 ? 'Spotify didn’t allow saving. Disconnect and connect again to grant the new permission.' : e.message, 'error');
    }
  }
  S.saved = next;
  renderSaved();
  fx.pulse(0.6);
  toast(next ? 'Saved to Liked Songs' : 'Removed from Liked Songs');
}

async function shareUrl(url, title) {
  try {
    if (navigator.share) await navigator.share({ title, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    }
  } catch {
    /* cancelled */
  }
}
function shareTrack() {
  const t = S.player.state.track;
  if (!t) return toast('Play something first.');
  shareUrl(t.demo ? location.href : `https://open.spotify.com/track/${t.uri.split(':').pop()}`, `${t.name} · ${t.artists}`);
}

async function devicePicker() {
  if (isDemo()) return toast('Connect your Spotify account to choose a device.');
  showModal('<div class="modal-card lg"><h2 class="title">Devices</h2><div class="loader"><i></i><i></i><i></i></div></div>');
  try {
    const { devices = [] } = (await Spotify.devices()) || {};
    const list = devices
      .map(
        (d) => `<button class="row device ${d.is_active ? 'on' : ''}" data-device="${esc(d.id)}">
          <span class="row-icon">${icons.device}</span>
          <span class="row-meta"><b>${esc(d.name)}${d.id === S.player.deviceId ? ' (this browser)' : ''}</b><span>${esc(d.type)}${d.is_active ? ' · playing' : ''}</span></span></button>`,
      )
      .join('');
    showModal(`<div class="modal-card lg">
      <h2 class="title">Devices</h2>
      <p class="muted">Choose where your music plays.</p>
      <div class="rows">${list || `<p class="muted">${isNative ? 'No devices yet. Open the Spotify app once, then come back.' : 'No devices found. Open Spotify on your phone or computer, or wait for the browser player to connect.'}</p>`}</div>
      <div class="modal-actions">
        ${isNative ? `<button class="pill-white" data-act="open-spotify">${icons.music} Open Spotify</button>` : ''}
        <button class="pill" data-act="close-modal">Close</button>
      </div></div>`);
  } catch (e) {
    closeModal();
    toast(e.message, 'error');
  }
}

function moreMenu() {
  showModal(`<div class="modal-card lg menu">
    <button class="row" data-act="share"><span class="row-icon">${icons.share}</span><span class="row-meta"><b>Share song</b></span></button>
    <button class="row" data-act="device"><span class="row-icon">${icons.device}</span><span class="row-meta"><b>Choose device</b></span></button>
    <button class="row" data-act="immersive-from-menu"><span class="row-icon">${icons.lyrics}</span><span class="row-meta"><b>Full screen lyrics</b></span></button>
    <button class="row" data-act="lyrics-timing"><span class="row-icon">${icons.clock}</span><span class="row-meta"><b>Lyrics timing</b></span></button>
    <button class="row" data-act="sleep"><span class="row-icon">${icons.moon}</span><span class="row-meta"><b>Sleep timer</b>${S.sleep ? '<span>On</span>' : ''}</span></button>
    <button class="row" data-act="settings"><span class="row-icon">${icons.sliders}</span><span class="row-meta"><b>Customize the look</b></span></button>
    <button class="pill wide" data-act="close-modal">Close</button>
  </div>`);
}

// ---------- queue ----------
async function refreshQueue() {
  const p = S.player;
  if (p.mode === 'demo') S.queue = p.queue.slice(p.index + 1).concat(p.queue.slice(0, p.index));
  else {
    try {
      const q = await Spotify.queue();
      S.queue = (q?.queue || []).map((x) => normTrack(x)).filter(Boolean).slice(0, 20);
    } catch {
      S.queue = [];
    }
  }
  $('#queue-list').innerHTML = S.queue.length
    ? S.queue.map((t, i) => trackRow(t, i, { attr: 'data-qi', art: true })).join('')
    : '<p class="muted pad">Nothing queued after this song.</p>';
}

// ---------- rows & cards ----------
function trackRow(t, i, { attr = 'data-ci', art = true, num = false } = {}) {
  return `<button class="row" ${attr}="${i}" data-tid="${esc(t.id)}">
    ${num ? `<span class="row-num">${i + 1}</span>` : ''}
    ${art ? `<img src="${esc(t.image || PLACEHOLDER)}" alt="" loading="lazy" />` : ''}
    <span class="row-meta"><b>${esc(t.name)}</b><span>${esc(t.artists)}</span></span>
    <span class="row-eq">${eqBars}</span>
    <span class="row-dur">${fmt(t.duration)}</span></button>`;
}

// ---------- playing things ----------
function playFrom(tracks, index, contextUri, contextName) {
  const p = S.player;
  if (contextName) {
    S.context = contextName;
    $('.np-context').textContent = contextName;
  }
  if (p.mode === 'demo') return p.play({ tracks, index });
  const t = tracks[index];
  if (contextUri && t) return p.play({ contextUri, offsetUri: t.uri });
  if (contextUri) return p.play({ contextUri });
  return p.play({ uris: tracks.slice(index, index + 100).map((x) => x.uri) });
}

// ---------- data ----------
async function loadLibrary() {
  if (isDemo()) {
    S.playlists = demoPlaylists().map((p) => ({ id: p.id, name: p.name, image: p.image, owner: p.owner, count: p.tracks.length }));
    S.recent = demoTracks();
  } else {
    const [pl, rec] = await Promise.allSettled([Spotify.playlists(), Spotify.recent()]);
    if (pl.status === 'fulfilled')
      S.playlists = (pl.value?.items || []).filter(Boolean).map((p) => ({
        id: p.id,
        uri: p.uri,
        name: p.name,
        image: bestImage(p.images, 300),
        owner: p.owner?.display_name,
        count: p.tracks?.total ?? p.items?.total,
      }));
    if (rec.status === 'fulfilled') {
      const seen = new Set();
      S.recent = (rec.value?.items || []).map((i) => normTrack(i.track)).filter((t) => t && !seen.has(t.id) && seen.add(t.id));
    }
  }
  const r = route();
  if (['home', 'library'].includes(r.name)) render();
}

async function fetchCollection(kind, id) {
  if (isDemo()) {
    if (kind === 'liked') {
      const tracks = demoTracks().filter((t) => S.demoSaved.has(t.id));
      return { type: 'Playlist', name: 'Liked Songs', sub: `${tracks.length} songs`, image: '', tracks, note: tracks.length ? '' : 'Tap the heart on a song to save it here.' };
    }
    const p = demoPlaylists().find((x) => x.id === id);
    if (!p) throw new Error('Not found');
    return { type: 'Playlist', name: p.name, sub: `${p.description} · ${p.tracks.length} songs`, image: p.image, tracks: p.tracks };
  }
  if (kind === 'liked') {
    const r = await Spotify.saved();
    return { type: 'Playlist', name: 'Liked Songs', sub: `${r.total ?? r.items.length} songs`, image: '', tracks: r.items.map((i) => normTrack(i.track)).filter(Boolean) };
  }
  if (kind === 'album') {
    const a = await Spotify.album(id);
    return {
      type: 'Album',
      name: a.name,
      sub: `${a.artists.map((x) => x.name).join(', ')} · ${a.release_date?.slice(0, 4) || ''}`,
      image: bestImage(a.images),
      contextUri: a.uri,
      share: `https://open.spotify.com/album/${a.id}`,
      tracks: (a.tracks?.items || []).map((t) => normTrack(t, a)),
    };
  }
  const p = await Spotify.playlist(id);
  let tracks = [];
  let note = '';
  try {
    const items = await Spotify.playlistItems(id);
    tracks = (items?.items || []).map(playlistEntryTrack).filter((t) => t?.uri && !t.is_local).map((t) => normTrack(t));
  } catch (e) {
    if (e.status === 403) note = 'Spotify only lets apps list the songs of playlists you own or collaborate on. You can still press Play.';
    else throw e;
  }
  return {
    type: 'Playlist',
    name: p.name,
    sub: `${p.owner?.display_name || ''}${tracks.length ? ` · ${tracks.length} songs` : ''}`,
    image: bestImage(p.images),
    contextUri: p.uri,
    share: `https://open.spotify.com/playlist/${p.id}`,
    tracks,
    note,
  };
}

// ---------- routing & pages ----------
function route() {
  const [name = 'home', id] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'home', id };
}
addEventListener('hashchange', () => render(true));

let renderReq = 0;
function setView(html) {
  view.innerHTML = `<div class="page">${html}</div>`;
  hydrateIcons(view);
  markPlayingRows();
}

async function render(scrollTop = false) {
  const my = ++renderReq;
  const r = route();
  setActiveTab(['home', 'library', 'liked', 'search'].includes(r.name) ? r.name : null);
  if (scrollTop) view.scrollTo({ top: 0 });
  view.dataset.page = r.name;
  if (r.name === 'library') return renderLibrary();
  if (r.name === 'search') return renderSearch();
  if (['liked', 'playlist', 'album'].includes(r.name)) return renderCollection(r.name, r.id, my);
  return renderHome();
}

function setActiveTab(name) {
  $$('[data-tab]').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  placeTabPill();
}
function placeTabPill() {
  const pill = $('.tab-pill');
  const on = $('.tabbar [data-tab].on');
  pill.style.opacity = on ? 1 : 0;
  if (on) {
    pill.style.left = `${on.offsetLeft}px`;
    pill.style.width = `${on.offsetWidth}px`;
  }
}
addEventListener('resize', placeTabPill);

function renderHome() {
  const first = S.me?.display_name?.split(' ')[0];
  const avatar = S.me?.images?.length ? bestImage(S.me.images, 120) : '';
  const chip = S.chip;
  const quick = [{ liked: true, name: 'Liked Songs' }, ...S.playlists.slice(0, 5)];
  setView(`
    <header class="page-top">
      <button class="circle lg avatar" data-act="settings" aria-label="You and settings">${avatar ? `<img src="${esc(avatar)}" alt="" />` : icons.user}</button>
      <div class="chips lg" role="tablist">${[['all', 'All'], ['playlists', 'Playlists'], ['recent', 'Recent']]
        .map(([k, l]) => `<button role="tab" data-chip="${k}" class="${chip === k ? 'on' : ''}" aria-selected="${chip === k}">${l}</button>`)
        .join('')}</div>
    </header>
    <h1 class="title page-title" data-text="">${greeting()}${first ? `, ${esc(first)}` : ''}</h1>
    ${
      isDemo()
        ? `<div class="card lg demo-card"><div><b>You’re exploring the demo</b><span class="muted">Connect Spotify Premium to play your own music.</span></div><button class="pill-white" data-act="connect">Connect</button></div>`
        : ''
    }
    ${
      chip !== 'recent'
        ? `<div class="quick-grid">${quick
            .map((q) =>
              q.liked
                ? `<button class="quick lg" data-open-liked><span class="liked-art">${icons.heart}</span><span>Liked Songs</span></button>`
                : `<button class="quick lg" data-open-playlist="${esc(q.id)}"><img src="${esc(q.image || PLACEHOLDER)}" alt="" loading="lazy" /><span>${esc(q.name)}</span></button>`,
            )
            .join('')}</div>`
        : ''
    }
    ${
      chip !== 'playlists' && S.recent.length
        ? `<h2 class="section">Jump back in</h2>
          <div class="hero-row">${S.recent
            .slice(0, 10)
            .map(
              (t, i) => `<button class="hero-card" data-ri="${i}" data-tilt="5" data-tid="${esc(t.id)}">
                <img src="${esc(t.image || PLACEHOLDER)}" alt="" loading="lazy" />
                <span class="hero-meta"><span class="kicker">Recently played</span><b>${esc(t.name)}</b><span>${esc(t.artists)}</span></span>
              </button>`,
            )
            .join('')}</div>`
        : ''
    }
    ${
      chip !== 'recent'
        ? `<h2 class="section">Your playlists</h2>
          <div class="square-row">${
            S.playlists
              .map(
                (p) => `<button class="sq" data-open-playlist="${esc(p.id)}" data-tilt="8">
                  <img src="${esc(p.image || PLACEHOLDER)}" alt="" loading="lazy" />
                  <b>${esc(p.name)}</b><span>${p.count != null ? `${p.count} songs` : esc(p.owner || '')}</span></button>`,
              )
              .join('') || '<p class="muted">No playlists yet.</p>'
          }</div>`
        : ''
    }
    ${chip === 'recent' ? `<div class="list rows">${S.recent.map((t, i) => trackRow(t, i, { attr: 'data-ri' })).join('') || '<p class="muted pad">Nothing played yet.</p>'}</div>` : ''}
  `);
}

function renderLibrary() {
  setView(`
    <h1 class="title page-title">Library</h1>
    <button class="quick lg wide" data-open-liked><span class="liked-art">${icons.heart}</span><span><b>Liked Songs</b><small>${isDemo() ? 'Songs you save in the demo' : 'Your saved songs'}</small></span></button>
    <h2 class="section">Playlists</h2>
    <div class="list rows">${
      S.playlists
        .map(
          (p) => `<button class="row" data-open-playlist="${esc(p.id)}">
            <img src="${esc(p.image || PLACEHOLDER)}" alt="" loading="lazy" />
            <span class="row-meta"><b>${esc(p.name)}</b><span>${esc(p.owner || '')}${p.count != null ? ` · ${p.count} songs` : ''}</span></span></button>`,
        )
        .join('') || '<p class="muted pad">No playlists yet.</p>'
    }</div>`);
}

function renderSearch() {
  setView(`
    <h1 class="title page-title">Search</h1>
    <label class="search-field lg"><span data-icon="search"></span><input id="search-input" type="search" placeholder="Songs, artists, albums, playlists" autocomplete="off" value="${esc(S.query)}" /></label>
    <div id="search-results"></div>`);
  const input = $('#search-input');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value.trim()), 320);
  });
  if (!isNative) input.focus({ preventScroll: true });
  runSearch(S.query);
}

let searchReq = 0;
async function runSearch(q) {
  S.query = q;
  const my = ++searchReq;
  const out = $('#search-results');
  if (!out) return;
  if (!q) {
    out.innerHTML = '<p class="muted pad">Find songs, artists, albums and playlists.</p>';
    return;
  }
  out.innerHTML = '<div class="loader"><i></i><i></i><i></i></div>';
  let tracks = [], albums = [], playlists = [], artists = [];
  try {
    if (isDemo()) {
      const k = q.toLowerCase();
      tracks = demoTracks().filter((t) => `${t.name} ${t.artists} ${t.album}`.toLowerCase().includes(k));
      playlists = demoPlaylists()
        .filter((p) => p.name.toLowerCase().includes(k) || p.tracks.some((t) => tracks.includes(t)))
        .map((p) => ({ id: p.id, name: p.name, image: p.image, sub: p.owner }));
    } else {
      const r = await Spotify.search(q);
      tracks = (r.tracks?.items || []).filter(Boolean).map((t) => normTrack(t));
      albums = (r.albums?.items || []).filter(Boolean).map((a) => ({ id: a.id, name: a.name, image: bestImage(a.images, 300), sub: a.artists?.map((x) => x.name).join(', ') }));
      playlists = (r.playlists?.items || []).filter(Boolean).map((p) => ({ id: p.id, name: p.name, image: bestImage(p.images, 300), sub: p.owner?.display_name }));
      artists = (r.artists?.items || []).filter(Boolean).map((a) => ({ name: a.name, image: bestImage(a.images, 300) }));
    }
  } catch (e) {
    if (my === searchReq) out.innerHTML = `<p class="muted pad">${esc(e.message)}</p>`;
    return;
  }
  if (my !== searchReq) return;
  S.searchTracks = tracks;
  const squares = (items, attr, round = false) =>
    `<div class="square-row">${items
      .map(
        (x) => `<button class="sq ${round ? 'round' : ''}" ${attr(x)} data-tilt="8">
          <img src="${esc(x.image || PLACEHOLDER)}" alt="" loading="lazy" /><b>${esc(x.name)}</b>${x.sub ? `<span>${esc(x.sub)}</span>` : ''}</button>`,
      )
      .join('')}</div>`;
  out.innerHTML =
    (tracks.length ? `<h2 class="section">Songs</h2><div class="list rows">${tracks.map((t, i) => trackRow(t, i, { attr: 'data-si' })).join('')}</div>` : '') +
    (artists.length ? `<h2 class="section">Artists</h2>${squares(artists, (a) => `data-artist="${esc(a.name)}"`, true)}` : '') +
    (albums.length ? `<h2 class="section">Albums</h2>${squares(albums, (a) => `data-open-album="${esc(a.id)}"`)}` : '') +
    (playlists.length ? `<h2 class="section">Playlists</h2>${squares(playlists, (p) => `data-open-playlist="${esc(p.id)}"`)}` : '') ||
    '<p class="muted pad">No results. Try different words.</p>';
  hydrateIcons(out);
  markPlayingRows();
}

async function renderCollection(kind, id, my) {
  setView(`<button class="circle lg back-fab" data-act="back" aria-label="Back" data-icon="back"></button><div class="loader top"><i></i><i></i><i></i></div>`);
  let info;
  try {
    info = await fetchCollection(kind, id);
  } catch (e) {
    if (my === renderReq) setView(`<button class="circle lg back-fab" data-act="back" aria-label="Back" data-icon="back"></button><p class="muted pad top">${esc(e.message)}</p>`);
    return;
  }
  if (my !== renderReq) return;
  S.collection = info;
  const art = info.image
    ? `<div class="art-melt" aria-hidden="true"><canvas class="melt coll-melt"></canvas></div><img class="coll-img" src="${esc(info.image)}" alt="" />`
    : `<div class="coll-img liked-art big">${icons.heart}</div>`;
  setView(`
    <button class="circle lg back-fab" data-act="back" aria-label="Back" data-icon="back"></button>
    <div class="coll">
      <div class="coll-hero">${art}
        <div class="coll-meta">
          <span class="kicker">${esc(info.type)}</span>
          <h1 class="title coll-title" data-text="${esc(info.name)}">${esc(info.name)}</h1>
          <p>${esc(info.sub)}</p>
          <div class="coll-actions">
            <button class="circle lg small" data-coll-shuffle aria-label="Shuffle">${icons.shuffle}</button>
            <button class="pill-white" data-coll-play>${icons.play}<span>Play</span></button>
            ${info.share ? `<button class="circle lg small" data-coll-share aria-label="Share">${icons.share}</button>` : '<span class="circle-spacer"></span>'}
          </div>
        </div>
      </div>
      ${info.note ? `<p class="note">${esc(info.note)}</p>` : ''}
      ${info.tracks.length ? `<div class="list rows tracklist">${info.tracks.map((t, i) => trackRow(t, i, { num: info.type === 'Album', art: info.type !== 'Album' })).join('')}</div>` : ''}
    </div>`);
  const cm = $('.coll-melt');
  if (cm) paintMelt(cm, info.image);
}

// ---------- player sheet & full screen lyrics (with the "melt" morph) ----------
function morph(from, to, apply) {
  if (!document.startViewTransition || !S.settings.motion || !from || !to || !from.getClientRects().length) return apply();
  from.style.viewTransitionName = 'hero-art';
  document.documentElement.classList.add('vt');
  const vt = document.startViewTransition(() => {
    from.style.viewTransitionName = '';
    to.style.viewTransitionName = 'hero-art';
    apply();
  });
  vt.finished.finally(() => {
    to.style.viewTransitionName = '';
    document.documentElement.classList.remove('vt');
  });
}

function openPlayer() {
  if (playerOpen()) return;
  morph($('.mini-art'), $('#player .art-inner'), () => {
    document.body.classList.add('player-open');
    $('#player').setAttribute('aria-hidden', 'false');
    $('#player').scrollTo({ top: 0 });
    lyMain.update(S.player.position());
  });
}
function closePlayer() {
  if (!playerOpen()) return;
  morph($('#player .art-inner'), $('.mini-art'), () => {
    document.body.classList.remove('player-open');
    $('#player').setAttribute('aria-hidden', 'true');
  });
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* not allowed right now */
  }
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && immersiveOpen() && keepAwake(true));

let calmTimer;
function wake() {
  const imm = $('#immersive');
  imm.classList.remove('calm');
  clearTimeout(calmTimer);
  calmTimer = setTimeout(() => immersiveOpen() && !S.player.state.paused && imm.classList.add('calm'), 3500);
}
['pointerdown', 'pointermove', 'wheel', 'keydown'].forEach((ev) => $('#immersive').addEventListener(ev, wake, { passive: true }));

function toggleImmersive() {
  const open = !immersiveOpen();
  const src = playerOpen() ? $('#player .art-inner') : $('.mini-art');
  const dst = innerWidth >= 900 ? $('#immersive .art-inner') : $('.imm-thumb');
  const [from, to] = open ? [src, dst] : [dst, src];
  morph(from, to, () => {
    document.body.classList.toggle('imm-open', open);
    $('#immersive').setAttribute('aria-hidden', String(!open));
    if (open) lyImm.update(S.player.position());
  });
  keepAwake(open);
  if (open) wake();
}

// ---------- lyric timing (per song) and sleep timer ----------
function lyricOffset(t) {
  if (!t) return 0;
  try {
    return Number(localStorage.getItem(`spotifier.lyricOffset.${t.id}`)) || 0;
  } catch {
    return 0;
  }
}
function setLyricOffset(delta) {
  const t = S.player.state.track;
  if (!t) return;
  const v = delta === 0 ? 0 : Math.max(-5000, Math.min(5000, lyricOffset(t) + delta));
  try {
    localStorage.setItem(`spotifier.lyricOffset.${t.id}`, String(v));
  } catch {
    /* ignore */
  }
  lyMain.setOffset(v);
  lyImm.setOffset(v);
  lyricTimingMenu();
}
function lyricTimingMenu() {
  const v = lyricOffset(S.player.state.track) / 1000;
  showModal(`<div class="modal-card lg menu">
    <h2 class="title">Lyrics timing</h2>
    <p class="muted">If the words light up too early or too late, nudge them. Saved for this song.</p>
    <div class="stepper"><button class="circle lg" data-offset="-250" aria-label="Earlier">−</button><b>${v > 0 ? '+' : ''}${v.toFixed(2)} s</b><button class="circle lg" data-offset="250" aria-label="Later">+</button></div>
    <div class="modal-actions"><button class="pill" data-offset="0">Reset</button><button class="pill-white" data-act="close-modal">Done</button></div>
  </div>`);
}
function sleepMenu() {
  const left = S.sleep?.until ? Math.max(0, Math.round((S.sleep.until - Date.now()) / 60000)) : null;
  showModal(`<div class="modal-card lg menu">
    <h2 class="title">Sleep timer</h2>
    <p class="muted">${S.sleep ? (S.sleep.endOfSong ? 'Pausing at the end of this song.' : `Pausing in ${left} min.`) : 'Music pauses by itself after:'}</p>
    <div class="rows">${[15, 30, 45, 60].map((m) => `<button class="row" data-sleep="${m}"><span class="row-meta"><b>${m} minutes</b></span></button>`).join('')}
      <button class="row" data-sleep="song"><span class="row-meta"><b>End of this song</b></span></button>
      ${S.sleep ? '<button class="row" data-sleep="off"><span class="row-meta"><b>Turn off</b></span></button>' : ''}</div>
    <button class="pill wide" data-act="close-modal">Close</button>
  </div>`);
}
function setSleep(v) {
  closeModal();
  if (v === 'off') {
    S.sleep = null;
    return toast('Sleep timer off');
  }
  if (v === 'song') {
    S.sleep = { endOfSong: true, track: S.trackId };
    return toast('Pausing at the end of this song');
  }
  S.sleep = { until: Date.now() + Number(v) * 60000 };
  toast(`Pausing in ${v} minutes`);
}

// ---------- sheet & modal ----------
function openSheet() {
  renderSettings();
  $('#settings').classList.add('open');
  $('#settings').setAttribute('aria-hidden', 'false');
  document.body.classList.add('sheet-open');
}
function closeSheet() {
  $('#settings').classList.remove('open');
  $('#settings').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('sheet-open');
}
function showModal(html) {
  const m = $('#modal');
  m.innerHTML = html;
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  hydrateIcons(m);
}
function closeModal() {
  const m = $('#modal');
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
}

// ---------- connect screen ----------
function openConnect(error) {
  const uri = redirectUri();
  const valid = redirectLooksValid();
  const fixUrl = location.href.replace('//localhost', '//127.0.0.1');
  showModal(`<div class="modal-card lg connect">
    <span class="kicker">Spotify Premium</span>
    <h2 class="title" data-text="Connect your account">Connect your account</h2>
    ${error ? `<p class="note error">${esc(error)}</p>` : ''}
    ${!valid ? `<p class="note error">Spotify doesn’t allow <b>localhost</b>. Open <a href="${esc(fixUrl)}">${esc(fixUrl)}</a> instead and connect from there.</p>` : ''}
    <ol class="steps">
      <li>Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a>, log in with your Premium account and press <b>Create app</b>.</li>
      <li>Under <b>Redirect URIs</b> paste this exactly, then press <b>Add</b>:
        <div class="copy-row"><code>${esc(uri)}</code><button class="circle lg small" data-copy="${esc(uri)}" aria-label="Copy redirect URI">${icons.copy}</button></div></li>
      <li>Tick <b>Web API</b>${isNative ? '' : ' and <b>Web Playback SDK</b>'}, accept the terms and <b>Save</b>.</li>
      <li>Open the app’s <b>Settings</b>, copy the <b>Client ID</b> and paste it below.</li>
    </ol>
    <label class="field"><span>Client ID</span><input id="client-id" value="${esc(getClientId())}" placeholder="32 letters and numbers" spellcheck="false" autocomplete="off" /></label>
    <div class="modal-actions">
      <button class="pill-white" data-act="do-login">Connect Spotify</button>
      <button class="pill" data-act="close-modal">${isDemo() ? 'Explore the demo first' : 'Close'}</button>
    </div>
    <p class="fine">Your login stays on this device. Spotifier never sees your password and has no server.</p>
  </div>`);
}

// ---------- settings ----------
function renderSettings() {
  const s = S.settings;
  const seg = (key, opts) =>
    `<div class="seg lg" role="group">${opts.map(([v, l]) => `<button data-seg="${key}" data-val="${v}" class="${s[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const slider = (key, label, min, max, step, show = (v) => v) =>
    `<label class="slider"><span>${label}<em>${show(s[key])}</em></span><input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}" /></label>`;
  const toggle = (key, label) =>
    `<label class="toggle"><span>${label}</span><input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''} /><i></i></label>`;
  const color = (key, label) => `<label class="swatch" style="--sw:${s[key]}"><input type="color" data-set="${key}" value="${s[key]}" /><span>${label}</span></label>`;
  $('#settings-body').innerHTML = `
    <section><h3>Theme</h3>
      <div class="presets">${Object.entries(PRESETS)
        .map(
          ([k, p]) => `<button class="preset ${s.preset === k ? 'on' : ''}" data-preset="${k}" style="--p1:${p.c1};--p2:${p.c2};--p3:${p.c3};--pa:${p.bgA};--pb:${p.bgB}">
            <span class="preset-orb"></span><span>${p.label}</span></button>`,
        )
        .join('')}</div>
      ${seg('mode', [['dark', 'Dark'], ['light', 'Light']])}
    </section>
    <section><h3>Album cover</h3>
      ${seg('cover', [['melt', 'Liquid melt'], ['frame', 'Rounded card']])}
      ${seg('backdrop', [['art', 'Cover backdrop'], ['aurora', 'Color glow']])}
      <p class="fine">Colors follow the album art</p>
      ${seg('reactive', [['off', 'Off'], ['background', 'Background'], ['all', 'Everything']])}
      <div class="swatches">${color('c1', 'Accent')}${color('c2', 'Glow')}${color('c3', 'Spark')}${color('bgA', 'Sky')}${color('bgB', 'Depth')}</div>
    </section>
    <section><h3>Liquid glass</h3>
      ${slider('refraction', 'Edge refraction', 0, 120, 1)}
      ${supportsRefraction() ? '' : '<p class="fine">Refraction needs Chrome, Edge, Brave, Opera or the Android app. Other browsers get frosted glass.</p>'}
      ${slider('blur', 'Frost', 0, 40, 1, (v) => `${v}px`)}
      ${slider('glass', 'Glass tint', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)}
      ${slider('radius', 'Card roundness', 8, 44, 1, (v) => `${v}px`)}
    </section>
    <section><h3>Motion & light</h3>
      ${slider('motion', 'Movement', 0, 1.6, 0.05, (v) => (v == 0 ? 'Still' : `${Math.round(v * 100)}%`))}
      ${toggle('tilt', 'Covers tilt toward the mouse')}
      ${toggle('light', 'Light follows the cursor')}
      ${toggle('bubbles', 'Floating soap bubbles')}
      ${s.bubbles ? slider('bubbleCount', 'Bubble count', 4, 50, 1) : ''}
    </section>
    <section><h3>Titles</h3>
      ${seg('titleStyle', [['clean', 'Clean'], ['chrome', 'Chrome'], ['bubbly', 'Bubbly'], ['serif', 'Serif']])}
      <p class="title title-preview" data-text="Liquid Glass">Liquid Glass</p>
    </section>
    <section><h3>Lyrics</h3>
      ${seg('lyricsStyle', [['bubbles', 'Bubbles'], ['karaoke', 'Karaoke'], ['glow', 'Glow']])}
      ${seg('lyricAlign', [['left', 'Left'], ['center', 'Centered']])}
      ${slider('lyricSize', 'Lyric size', 0.8, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`)}
    </section>
    ${
      isNative
        ? `<section><h3>Playback</h3>
      ${toggle('inAppPlayback', 'Play inside Spotifier')}
      <p class="fine">On: music plays right here, no Spotify app needed (experimental, needs Premium). Off: Spotifier controls the Spotify app instead. Changing this restarts Spotifier.</p>
    </section>`
        : ''
    }
    <section><h3>Account</h3>
      <p class="muted">${isDemo() ? 'You’re in demo mode.' : `Connected as <b>${esc(S.me?.display_name || 'you')}</b>.`}</p>
      <div class="modal-actions">${
        isDemo() ? `<button class="pill-white" data-act="connect">Connect Spotify</button>` : `<button class="pill" data-act="logout">${icons.logout} Disconnect</button>`
      }</div>
    </section>
    <button class="pill wide" data-act="reset-look">Reset the look</button>`;
}

const COLOR_KEYS = ['c1', 'c2', 'c3', 'bgA', 'bgB'];
function updateSetting(key, value) {
  S.settings[key] = value;
  if (COLOR_KEYS.includes(key)) S.settings.preset = 'custom';
  theme();
  saveSettings(S.settings);
}

$('#settings-body').addEventListener('input', (e) => {
  const el = e.target.closest('[data-set]');
  if (!el) return;
  const key = el.dataset.set;
  const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
  updateSetting(key, v);
  if (key === 'bubbles') renderSettings();
  if (key === 'inAppPlayback') setTimeout(() => location.reload(), 400);
  const em = el.closest('.slider')?.querySelector('em');
  if (em) {
    const pct = (x) => `${Math.round(x * 100)}%`;
    const fmts = { blur: (x) => `${x}px`, radius: (x) => `${x}px`, glass: pct, lyricSize: pct, motion: (x) => (x == 0 ? 'Still' : pct(x)) };
    em.textContent = (fmts[key] || String)(v);
  }
  const sw = el.closest('.swatch');
  if (sw) sw.style.setProperty('--sw', v);
});

// ---------- clicks ----------
const actions = {
  toggle: () => S.player.toggle(),
  next: () => S.player.next(),
  prev: () => S.player.prev(),
  shuffle: () => S.player.setShuffle(!S.player.state.shuffle),
  repeat: () => S.player.setRepeat({ off: 'context', context: 'track', track: 'off' }[S.player.state.repeat] || 'off'),
  mute: () => {
    const v = S.player.state.volume;
    if (v > 0) {
      S.muteFrom = v;
      S.player.setVolume(0);
    } else S.player.setVolume(S.muteFrom || 0.7);
  },
  save: toggleSave,
  share: () => {
    closeModal();
    shareTrack();
  },
  device: devicePicker,
  more: moreMenu,
  'play-here': () => S.player.playHere?.(),
  'open-spotify': () => {
    closeModal();
    openSpotifyApp();
  },
  'open-player': openPlayer,
  'close-player': closePlayer,
  'lyrics-timing': lyricTimingMenu,
  sleep: sleepMenu,
  immersive: toggleImmersive,
  'immersive-from-menu': () => {
    closeModal();
    toggleImmersive();
  },
  back: () => (history.length > 1 ? history.back() : (location.hash = '#/home')),
  settings: () => {
    closeModal();
    openSheet();
  },
  'close-sheet': closeSheet,
  'close-modal': closeModal,
  connect: () => {
    closeSheet();
    openConnect();
  },
  'do-login': async () => {
    const id = $('#client-id').value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) return toast('That doesn’t look like a Client ID. It should be 32 letters and numbers.', 'error');
    setClientId(id);
    try {
      await login();
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  logout: () => {
    logout();
    location.reload();
  },
  'reset-look': () => {
    S.settings = { ...DEFAULTS };
    theme();
    saveSettings(S.settings);
    renderSettings();
  },
};

document.addEventListener('click', (e) => {
  const t = e.target;
  if (swallowClick) {
    swallowClick = false;
    e.preventDefault();
    return;
  }
  let el;
  const act = t.closest('[data-act]');
  if (t.closest('button, a, [role="button"]')) haptic();
  if (act) {
    e.preventDefault();
    return actions[act.dataset.act]?.(act, e);
  }
  if ((el = t.closest('[data-offset]'))) return setLyricOffset(Number(el.dataset.offset));
  if ((el = t.closest('[data-sleep]'))) return setSleep(el.dataset.sleep);
  if ((el = t.closest('[data-chip]'))) {
    S.chip = el.dataset.chip;
    return renderHome();
  }
  if ((el = t.closest('[data-qi]'))) {
    const i = Number(el.dataset.qi);
    const p = S.player;
    if (p.mode === 'demo') return p.play({ tracks: p.queue, index: (p.index + 1 + i) % p.queue.length });
    return p.play({ uris: S.queue.slice(i).map((x) => x.uri) });
  }
  if ((el = t.closest('[data-ci]'))) return playFrom(S.collection.tracks, Number(el.dataset.ci), S.collection.contextUri, S.collection.name);
  if (t.closest('[data-coll-play]') || t.closest('[data-coll-shuffle]')) {
    const c = S.collection;
    if (!c.tracks.length && !c.contextUri) return toast('Nothing to play here yet.');
    const shuffle = !!t.closest('[data-coll-shuffle]');
    S.player.setShuffle(shuffle);
    const start = shuffle && c.tracks.length ? Math.floor(Math.random() * c.tracks.length) : 0;
    return playFrom(c.tracks, start, c.contextUri, c.name);
  }
  if (t.closest('[data-coll-share]')) return shareUrl(S.collection.share, S.collection.name);
  if ((el = t.closest('[data-si]'))) return playFrom(S.searchTracks, Number(el.dataset.si), null, 'Search');
  if ((el = t.closest('[data-ri]'))) return playFrom(S.recent, Number(el.dataset.ri), null, 'Recently played');
  if ((el = t.closest('[data-open-playlist]'))) return (location.hash = `#/playlist/${el.dataset.openPlaylist}`);
  if ((el = t.closest('[data-open-album]'))) return (location.hash = `#/album/${el.dataset.openAlbum}`);
  if (t.closest('[data-open-liked]')) return (location.hash = '#/liked');
  if ((el = t.closest('[data-artist]'))) {
    S.query = el.dataset.artist;
    if (route().name === 'search') {
      $('#search-input').value = S.query;
      return runSearch(S.query);
    }
    return (location.hash = '#/search');
  }
  if ((el = t.closest('[data-device]'))) {
    closeModal();
    const id = el.dataset.device;
    if (id === S.player.deviceId) return S.player.playHere();
    return Spotify.transfer(id, true)
      .then(() => setTimeout(() => S.player.refresh(), 800))
      .catch((err) => toast(err.message, 'error'));
  }
  if ((el = t.closest('[data-preset]'))) {
    const k = el.dataset.preset;
    const { label, ...colors } = PRESETS[k];
    Object.assign(S.settings, colors, { preset: k });
    theme();
    saveSettings(S.settings);
    return renderSettings();
  }
  if ((el = t.closest('[data-seg]'))) {
    updateSetting(el.dataset.seg, el.dataset.val);
    return renderSettings();
  }
  if ((el = t.closest('[data-copy]'))) {
    navigator.clipboard?.writeText(el.dataset.copy).then(() => toast('Copied'));
    return;
  }
  if (t.classList.contains('modal-wrap')) closeModal();
});

// Escape / Android back closes one layer at a time
function goBackOneLayer() {
  if ($('#modal').classList.contains('open')) return closeModal(), true;
  if (immersiveOpen()) return toggleImmersive(), true;
  if (document.body.classList.contains('sheet-open')) return closeSheet(), true;
  if (playerOpen()) return closePlayer(), true;
  return false;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return goBackOneLayer();
  if (e.key === 'Enter' && e.target.matches?.('[role="button"][data-act]')) return actions[e.target.dataset.act]?.();
  if (e.target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const onSlider = e.target.closest('[role="slider"]');
  if (e.code === 'Space' && !e.target.closest('button, a, [role="slider"], [role="button"]')) {
    e.preventDefault();
    S.player.toggle();
  } else if (e.key === 'ArrowRight' && !onSlider) S.player.seek(S.player.position() + 5000);
  else if (e.key === 'ArrowLeft' && !onSlider) S.player.seek(Math.max(0, S.player.position() - 5000));
  else if (e.key.toLowerCase() === 'l') toggleImmersive();
  else if (e.key.toLowerCase() === 'p') playerOpen() ? closePlayer() : openPlayer();
  else if (e.key === '/') {
    e.preventDefault();
    location.hash = '#/search';
  }
});

// ---------- frame loop ----------
let lastSec = -1;
let lastBar = 0;
const miniLine = $('.mini-line i');
function loop(now) {
  const p = S.player;
  if (p) {
    const pos = p.position();
    const dur = p.state.duration;
    const frac = dur ? clamp(pos / dur, 0, 1) : 0;
    if (now - lastBar > 100) {
      lastBar = now;
      if (playerOpen() || immersiveOpen()) for (const r of ranges) if (r.kind === 'seek' && !r.dragging) r.el.style.setProperty('--p', frac.toFixed(4));
      if (S.sleep?.until && Date.now() > S.sleep.until) {
        S.sleep = null;
        if (!p.state.paused) p.toggle();
        toast('Sleep timer: music paused');
      }
      miniLine.style.transform = `scaleX(${frac.toFixed(4)})`;
    }
    const sec = Math.floor(pos / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      if (!ranges.some((r) => r.kind === 'seek' && r.dragging)) $('.t-pos').textContent = fmt(pos);
      $('.t-left').textContent = `-${fmt(Math.max(0, dur - pos))}`;
    }
    if (immersiveOpen()) lyImm.update(pos);
    else if (playerOpen()) lyMain.update(pos);
  }
  requestAnimationFrame(loop);
}

// ---------- gestures ----------
let swallowClick = false;

/** Drag down to dismiss (Now Playing, full-screen lyrics), like an iOS sheet. */
function swipeToClose(el, { canStart, onClose, handle }) {
  let y0 = null, x0 = 0, dy = 0, dragging = false;
  (handle || el).addEventListener('touchstart', (e) => {
    if (!canStart(e)) return;
    y0 = e.touches[0].clientY;
    x0 = e.touches[0].clientX;
    dy = 0;
    dragging = false;
  }, { passive: true });
  (handle || el).addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    const dx = Math.abs(e.touches[0].clientX - x0);
    if (!dragging && (dy < 8 || dx > dy)) {
      if (dy < -8 || dx > 12) y0 = null;
      return;
    }
    dragging = true;
    el.style.transition = 'none';
    el.style.translate = `0 ${Math.max(0, dy * 0.85)}px`;
    el.style.scale = String(1 - Math.min(0.06, dy / 4000));
  }, { passive: true });
  (handle || el).addEventListener('touchend', () => {
    if (y0 == null) return;
    y0 = null;
    el.style.transition = '';
    el.style.translate = '';
    el.style.scale = '';
    if (dragging && dy > 120) {
      haptic();
      onClose();
    }
  }, { passive: true });
}
swipeToClose($('#player'), { canStart: () => $('#player').scrollTop <= 0, onClose: closePlayer });
swipeToClose($('#immersive'), { canStart: (e) => !e.target.closest('.lyrics-box'), onClose: toggleImmersive });

// Mini player: swipe sideways to skip, swipe up to open
(() => {
  const mini = $('.mini');
  let x0 = null, y0 = 0;
  mini.addEventListener('touchstart', (e) => {
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  mini.addEventListener('touchmove', (e) => {
    if (x0 == null) return;
    const dx = e.touches[0].clientX - x0;
    if (Math.abs(dx) > 10) mini.querySelector('.mini-meta').style.translate = `${dx * 0.4}px 0`;
  }, { passive: true });
  mini.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    const meta = mini.querySelector('.mini-meta');
    meta.style.translate = '';
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      swallowClick = true;
      haptic('Medium');
      dx < 0 ? S.player.next() : S.player.prev();
    } else if (dy < -40 && Math.abs(dy) > Math.abs(dx)) {
      swallowClick = true;
      openPlayer();
    }
  }, { passive: true });
})();

// Cover: tap for full-screen lyrics, double-tap to like
(() => {
  const art = $('.player-art');
  let timer = null;
  art.addEventListener('click', () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      haptic('Medium');
      const burst = art.querySelector('.like-burst');
      burst.classList.remove('go');
      void burst.offsetWidth;
      burst.classList.add('go');
      if (!S.saved) toggleSave();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      toggleImmersive();
    }, 260);
  });
})();

// ---------- boot ----------
async function startSpotify() {
  wirePlayer(new SpotifyPlayer({ inApp: S.settings.inAppPlayback !== false }));
  try {
    S.me = await Spotify.me();
  } catch (e) {
    if (e.status === 401) {
      logout();
      return startDemo('Your Spotify session expired. Please connect again.');
    }
    if (e.status === 403)
      openConnect(`Spotify said: “${e.message}”. In your app on the Spotify dashboard, open User Management and add the name and email of your Spotify account, then connect again.`);
    else toast(e.message, 'error');
  }
  if (S.me && S.me.product !== 'premium') toast('This Spotify account isn’t Premium, so playback control won’t work. You can still browse and see lyrics.', 'warn', 8000);
  render();
  loadLibrary();
}

function startDemo(error) {
  const p = new DemoPlayer();
  p.queue = demoTracks();
  p.index = 0;
  p._load(false);
  S.context = 'Liquid Hours';
  wirePlayer(p);
  loadLibrary();
  render();
  openConnect(error);
}

function wireNative() {
  onAppUrl(async (url) => {
    if (!url.startsWith(NATIVE_REDIRECT)) return;
    closeBrowser();
    try {
      if (await handleCallback(url)) location.reload();
    } catch (e) {
      openConnect(e.message);
    }
  });
  onBackButton(() => {
    if (goBackOneLayer()) return;
    if (route().name !== 'home') return history.back();
    minimize();
  });
  onResume(() => S.player?.onResume?.());
}

async function boot() {
  hydrateIcons();
  theme();
  fx.start();
  initLens({ refraction: S.settings.refraction, supported: supportsRefraction() });
  wireNative();
  let error;
  try {
    if (await handleCallback()) toast('Connected to Spotify', 'ok');
  } catch (e) {
    error = e.message;
  }
  if (isLoggedIn() && !error) startSpotify();
  else startDemo(error);
  requestAnimationFrame(loop);
}

boot();
