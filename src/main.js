import { icons, $, $$, esc, fmt, toast, greeting, clamp, eqBars } from './util.js';
import { loadSettings, saveSettings, applyTheme, extractPalette, PRESETS, DEFAULTS, supportsRefraction } from './theme.js';
import { initFX } from './fx.js';
import { DemoPlayer, SpotifyPlayer } from './player.js';
import { LyricsView, getLyrics } from './lyrics.js';
import { Spotify, normTrack, bestImage, playlistEntryTrack } from './api.js';
import { handleCallback, isLoggedIn, login, logout, getClientId, setClientId, redirectUri, redirectLooksValid } from './auth.js';
import { demoTracks, demoPlaylists } from './demo.js';

const PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#7d68b0'/><stop offset='1' stop-color='#2a2140'/></linearGradient></defs><rect width='100' height='100' fill='url(#g)'/><path d='M42 66V38l22-5v26' fill='none' stroke='#fff' stroke-opacity='.55' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/><circle cx='37' cy='66' r='6' fill='#fff' fill-opacity='.55'/><circle cx='59' cy='60' r='6' fill='#fff' fill-opacity='.55'/></svg>`,
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
  muteFrom: 0.7,
};

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
}

// ---------- lyrics ----------
const immersiveOpen = () => document.body.classList.contains('imm-open');
function onLyricLine(view, i) {
  fx.pulse(0.3);
  const visible = view === lyImm ? immersiveOpen() : !immersiveOpen() && view.el.offsetParent;
  const node = view.nodes[i];
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
  status('<div class="loader"><i></i><i></i><i></i></div><p>Finding lyrics…</p>');
  try {
    const r = await getLyrics(t);
    if (my !== lyricsReq) return;
    if (r.instrumental) status('<p class="big-note">♪ Instrumental</p><p>No words on this one. Just enjoy the music.</p>');
    else if (!r.lines.length) status('<p class="big-note">No lyrics found</p><p>The free lyrics library (LRCLIB) doesn’t have this song yet.</p>');
    else views.forEach((v) => v.set(r));
  } catch {
    if (my === lyricsReq) status('<p class="big-note">Lyrics are offline</p><p>Couldn’t reach the lyrics service. Check your connection.</p>');
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
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0;
    if (!d) return;
    e.preventDefault();
    const v = clamp(cur + d, 0, 1);
    el.style.setProperty('--p', v);
    onCommit?.(v);
  });
  ranges.push(r);
  return r;
}
for (const el of $$('.progress, .mini-progress')) {
  makeRange(el, {
    kind: 'seek',
    onInput: (v) => $$('.t-pos').forEach((t) => (t.textContent = fmt(v * S.player.state.duration))),
    onCommit: (v) => S.player.seek(v * S.player.state.duration),
  });
}
makeRange($('.volume'), { kind: 'volume', onInput: (v) => S.player.setVolume(v), onCommit: (v) => S.player.setVolume(v) });

// ---------- player wiring ----------
function wirePlayer(p) {
  S.player = p;
  p.addEventListener('change', onPlayerChange);
  p.addEventListener('error', (e) => toast(e.detail, 'error', 6500));
  p.addEventListener('ready', () => toast('Browser player connected. Pick a song or tap Device to move playback here.', 'ok'));
  onPlayerChange();
}

function onPlayerChange() {
  const s = S.player.state;
  const t = s.track;
  if ((t?.id ?? null) !== S.trackId) {
    S.trackId = t?.id ?? null;
    onTrack(t);
  }
  for (const b of $$('.play-bubble')) {
    b.innerHTML = s.paused ? icons.play : icons.pause;
    b.setAttribute('aria-label', s.paused ? 'Play' : 'Pause');
  }
  document.documentElement.classList.toggle('is-playing', !s.paused && !!t);
  $$('[data-act="shuffle"]').forEach((b) => b.classList.toggle('on', s.shuffle));
  $$('[data-act="repeat"]').forEach((b) => {
    b.classList.toggle('on', s.repeat !== 'off');
    b.innerHTML = s.repeat === 'track' ? icons.repeatOne : icons.repeat;
  });
  const vol = ranges.find((r) => r.kind === 'volume');
  if (!vol.dragging) vol.el.style.setProperty('--p', s.volume);
  $$('[data-act="mute"]').forEach((b) => (b.innerHTML = s.volume === 0 ? icons.mute : icons.volume));

  const dl = $('.device-line');
  const remote = S.player.remote;
  dl.innerHTML = s.device
    ? `<span class="dot"></span>Playing on <b>${esc(s.device)}</b>${remote ? ' <button class="text-btn" data-act="play-here">Play here instead</button>' : ''}`
    : '';
  renderQueueNow();
}

async function onTrack(t) {
  $$('.np-art').forEach((img) => (img.src = t?.image || PLACEHOLDER));
  $$('.np-title').forEach((el) => {
    el.textContent = t?.name || 'Nothing playing';
    el.dataset.text = el.textContent;
  });
  $$('.np-artist').forEach((el) => (el.textContent = t ? t.artists : 'Pick something from your library'));
  $('.np-name').textContent = t?.name || 'Nothing playing';
  $('.np-artist-small').textContent = t?.artists || '';
  document.title = t ? `${t.name} · ${t.artists}` : 'Spotifier';
  // replay the entrance animation
  $$('.art-frame').forEach((f) => {
    f.classList.remove('swap');
    void f.offsetWidth;
    f.classList.add('swap');
  });
  fx.pulse(1);
  loadLyrics(t);
  refreshQueue();
  checkSaved();
  const pal = t?.image ? await extractPalette(t.image) : null;
  if (t?.id === S.trackId) {
    S.palette = pal;
    theme();
  }
}

// ---------- save / share / device ----------
async function checkSaved() {
  const t = S.player.state.track;
  S.saved = false;
  if (t && S.player.mode === 'demo') S.saved = S.demoSaved.has(t.id);
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
    const label = b.querySelector('b');
    if (label) label.textContent = S.saved ? 'Saved' : 'Save';
  });
}

async function toggleSave() {
  const t = S.player.state.track;
  if (!t) return toast('Play something first.');
  const next = !S.saved;
  if (S.player.mode === 'demo') {
    next ? S.demoSaved.add(t.id) : S.demoSaved.delete(t.id);
  } else {
    try {
      await Spotify.setSaved(t.uri, next);
    } catch (e) {
      return toast(e.status === 403 ? 'Spotify didn’t allow saving. Disconnect and connect again to grant the new permission.' : e.message, 'error');
    }
  }
  S.saved = next;
  renderSaved();
  fx.pulse(0.6);
  toast(next ? 'Saved to your Liked Songs ♥' : 'Removed from Liked Songs');
}

async function share() {
  const t = S.player.state.track;
  if (!t) return toast('Play something first.');
  const url = t.demo ? location.href : `https://open.spotify.com/track/${t.uri.split(':').pop()}`;
  try {
    if (navigator.share) await navigator.share({ title: t.name, text: `${t.name} by ${t.artists}`, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied to clipboard');
    }
  } catch {
    /* user cancelled */
  }
}

async function devicePicker() {
  if (S.player.mode === 'demo') return toast('Connect your Spotify account to choose a device.');
  showModal('<div class="modal-card glass lit"><h2 class="title" data-text="Devices">Devices</h2><div class="loader"><i></i><i></i><i></i></div></div>');
  try {
    const { devices = [] } = (await Spotify.devices()) || {};
    const list = devices
      .map(
        (d) => `<button class="row device ${d.is_active ? 'on' : ''}" data-device="${esc(d.id)}">
          <span class="row-icon">${icons.device}</span>
          <span class="row-meta"><b>${esc(d.name)}${d.id === S.player.deviceId ? ' (this browser)' : ''}</b><span>${esc(d.type)}${d.is_active ? ' · playing' : ''}</span></span></button>`,
      )
      .join('');
    showModal(`<div class="modal-card glass lit">
      <h2 class="title" data-text="Devices">Devices</h2>
      <p class="muted">Choose where your music plays.</p>
      <div class="rows">${list || '<p class="muted">No devices found. Open Spotify on your phone or computer, or wait for the browser player to connect.</p>'}</div>
      <button class="btn ghost" data-act="close-modal">Close</button></div>`);
  } catch (e) {
    closeModal();
    toast(e.message, 'error');
  }
}

// ---------- queue ----------
async function refreshQueue() {
  const p = S.player;
  if (p.mode === 'demo') {
    S.queue = p.queue.slice(p.index + 1).concat(p.queue.slice(0, p.index));
  } else {
    try {
      const q = await Spotify.queue();
      S.queue = (q?.queue || []).map((x) => normTrack(x)).filter(Boolean).slice(0, 25);
    } catch {
      S.queue = [];
    }
  }
  renderQueue();
}

function renderQueueNow() {
  const t = S.player?.state.track;
  const s = S.player?.state;
  $('#queue-current').innerHTML = t
    ? `<div class="card q-now" data-tilt="5">
        <div class="q-art"><img src="${esc(t.image || PLACEHOLDER)}" alt="" />${s.paused ? '' : eqBars}</div>
        <div class="q-meta"><b class="accent">${esc(t.name)}</b><span>${esc(t.artists)}</span></div>
        <button class="play-bubble tiny" data-act="toggle" aria-label="${s.paused ? 'Play' : 'Pause'}">${s.paused ? icons.play : icons.pause}</button>
      </div>`
    : `<div class="card q-empty"><p class="big-note">Nothing playing yet</p><p class="muted">Open your library and pick a playlist.</p><button class="btn" data-act="menu">Open library</button></div>`;
}

function renderQueue() {
  renderQueueNow();
  $('#queue-list').innerHTML = S.queue.length
    ? S.queue
        .map(
          (t, i) => `<button class="card q-item" data-tilt="5" data-qi="${i}" style="--i:${i}">
            <img src="${esc(t.image || PLACEHOLDER)}" alt="" loading="lazy" />
            <span class="q-meta"><b>${esc(t.name)}</b><span>${esc(t.artists)}</span></span>
            <span class="q-dur">${fmt(t.duration)}</span></button>`,
        )
        .join('')
    : S.player?.state.track
      ? '<p class="muted pad">Nothing queued after this song.</p>'
      : '';
  const pick = S.playlists[Math.abs(hash(S.trackId || 'x')) % Math.max(1, S.playlists.length)];
  $('#queue-banner').innerHTML = pick
    ? `<button class="banner" data-open-playlist="${esc(pick.id)}" style="--img:url('${esc(pick.image || PLACEHOLDER)}')">
        <span class="eyebrow">From your library</span><span class="banner-title">${esc(pick.name)}</span></button>`
    : '';
}
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);

// ---------- playing things ----------
function playFrom(tracks, index, contextUri) {
  const p = S.player;
  if (p.mode === 'demo') return p.play({ tracks, index });
  const t = tracks[index];
  if (contextUri && t) return p.play({ contextUri, offsetUri: t.uri });
  if (contextUri) return p.play({ contextUri });
  return p.play({ uris: tracks.slice(index, index + 100).map((x) => x.uri) });
}

// ---------- library drawer ----------
async function loadLibrary() {
  if (S.player.mode === 'demo') {
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
      S.recent = (rec.value?.items || [])
        .map((i) => normTrack(i.track))
        .filter((t) => t && !seen.has(t.id) && seen.add(t.id));
    }
  }
  renderLibraryHome();
  renderQueue();
}

function renderLibraryHome() {
  const me = S.me;
  const demo = S.player.mode === 'demo';
  const avatar = me?.images?.length ? bestImage(me.images, 120) : '';
  $('#library-body').innerHTML = `
    <div class="profile">
      <div class="avatar">${avatar ? `<img src="${esc(avatar)}" alt="" />` : icons.sparkle}</div>
      <div class="profile-meta">
        <b>${demo ? 'Demo mode' : `${greeting()}, ${esc(me?.display_name || 'friend')}`}</b>
        <span>${demo ? 'Connect Spotify to use your own music' : me?.product === 'premium' ? 'Spotify Premium' : esc(me?.product || '')}</span>
      </div>
      ${demo ? '<button class="btn small" data-act="connect">Connect</button>' : ''}
    </div>
    <button class="liked card" data-open-liked data-tilt="6">
      <span class="liked-icon">${icons.heart}</span>
      <span><b>Liked Songs</b><span class="muted">${demo ? 'Songs you save in demo mode' : 'Your saved songs'}</span></span>
    </button>
    ${
      S.recent.length
        ? `<p class="eyebrow">Jump back in</p><div class="bubble-row">${S.recent
            .slice(0, 12)
            .map(
              (t, i) => `<button class="bubble-card" data-ri="${i}" data-tilt="14" style="--i:${i}" title="${esc(t.name)}">
                <span class="bubble"><img src="${esc(t.image || PLACEHOLDER)}" alt="" loading="lazy" /><span class="bubble-gloss"></span></span>
                <span class="bubble-label">${esc(t.name)}</span></button>`,
            )
            .join('')}</div>`
        : ''
    }
    <p class="eyebrow">Playlists</p>
    <div class="rows">${
      S.playlists
        .map(
          (p) => `<button class="row" data-open-playlist="${esc(p.id)}">
            <img src="${esc(p.image || PLACEHOLDER)}" alt="" loading="lazy" />
            <span class="row-meta"><b>${esc(p.name)}</b><span>${esc(p.owner || '')}${p.count != null ? ` · ${p.count} songs` : ''}</span></span></button>`,
        )
        .join('') || '<p class="muted">No playlists yet.</p>'
    }</div>`;
}

async function openCollection(kind, id) {
  openPanel('library');
  const body = $('#library-body');
  body.innerHTML = '<div class="loader"><i></i><i></i><i></i></div>';
  let info;
  try {
    info = await fetchCollection(kind, id);
  } catch (e) {
    body.innerHTML = `<button class="text-btn back" data-lib-back>${icons.back} Library</button><p class="muted pad">${esc(e.message)}</p>`;
    return;
  }
  S.collection = info;
  body.innerHTML = `
    <button class="text-btn back" data-lib-back>${icons.back} Library</button>
    <div class="coll-head">
      <div class="bubble big" data-tilt="12"><img src="${esc(info.image || PLACEHOLDER)}" alt="" /><span class="bubble-gloss"></span></div>
      <p class="eyebrow">${esc(info.type)}</p>
      <h3 class="title coll-title" data-text="${esc(info.name)}">${esc(info.name)}</h3>
      <p class="muted">${esc(info.sub)}</p>
      <button class="play-bubble" data-coll-play aria-label="Play all">${icons.play}</button>
    </div>
    ${info.note ? `<p class="note">${esc(info.note)}</p>` : ''}
    <div class="rows">${info.tracks
      .map(
        (t, i) => `<button class="row" data-ci="${i}">
          <span class="row-num">${i + 1}</span>
          <img src="${esc(t.image || PLACEHOLDER)}" alt="" loading="lazy" />
          <span class="row-meta"><b>${esc(t.name)}</b><span>${esc(t.artists)}</span></span>
          <span class="row-dur">${fmt(t.duration)}</span></button>`,
      )
      .join('')}</div>`;
}

async function fetchCollection(kind, id) {
  if (S.player.mode === 'demo') {
    if (kind === 'liked') {
      const tracks = demoTracks().filter((t) => S.demoSaved.has(t.id));
      return { type: 'Playlist', name: 'Liked Songs', sub: `${tracks.length} songs`, image: tracks[0]?.image, tracks, note: tracks.length ? '' : 'Tap Save on a song to add it here.' };
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
    if (e.status === 403) note = 'Spotify only lets apps list the songs of playlists you own or collaborate on. You can still press play.';
    else throw e;
  }
  return {
    type: 'Playlist',
    name: p.name,
    sub: `${p.owner?.display_name || ''}${tracks.length ? ` · ${tracks.length} songs` : ''}`,
    image: bestImage(p.images),
    contextUri: p.uri,
    tracks,
    note,
  };
}

// ---------- search ----------
let searchTimer;
let searchReq = 0;
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(e.target.value.trim()), 320);
});

async function runSearch(q) {
  const my = ++searchReq;
  const out = $('#search-results');
  if (!q) {
    out.innerHTML = '<p class="muted pad">Type to search for songs, artists, albums and playlists.</p>';
    return;
  }
  out.innerHTML = '<div class="loader"><i></i><i></i><i></i></div>';
  let tracks = [], albums = [], playlists = [], artists = [];
  try {
    if (S.player.mode === 'demo') {
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
  const bubbles = (items, attr) =>
    `<div class="bubble-row">${items
      .map(
        (x, i) => `<button class="bubble-card" ${attr(x)} data-tilt="14" style="--i:${i}" title="${esc(x.name)}">
          <span class="bubble"><img src="${esc(x.image || PLACEHOLDER)}" alt="" loading="lazy" /><span class="bubble-gloss"></span></span>
          <span class="bubble-label">${esc(x.name)}</span>${x.sub ? `<span class="bubble-sub">${esc(x.sub)}</span>` : ''}</button>`,
      )
      .join('')}</div>`;
  out.innerHTML =
    (tracks.length
      ? `<p class="eyebrow">Songs</p><div class="rows">${tracks
          .map(
            (t, i) => `<button class="row" data-si="${i}"><img src="${esc(t.image || PLACEHOLDER)}" alt="" loading="lazy" />
              <span class="row-meta"><b>${esc(t.name)}</b><span>${esc(t.artists)}</span></span><span class="row-dur">${fmt(t.duration)}</span></button>`,
          )
          .join('')}</div>`
      : '') +
    (artists.length ? `<p class="eyebrow">Artists</p>${bubbles(artists, (a) => `data-artist="${esc(a.name)}"`)}` : '') +
    (albums.length ? `<p class="eyebrow">Albums</p>${bubbles(albums, (a) => `data-open-album="${esc(a.id)}"`)}` : '') +
    (playlists.length ? `<p class="eyebrow">Playlists</p>${bubbles(playlists, (p) => `data-open-playlist="${esc(p.id)}"`)}` : '') ||
    '<p class="muted pad">No results. Try different words.</p>';
}

// ---------- panels, drawers, tabs ----------
function openPanel(id) {
  closePanels(id);
  const el = $(`#${id}`);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');
  if (id === 'search') setTimeout(() => $('#search-input').focus(), 120);
  if (id === 'settings') renderSettings();
}
function closePanels(except) {
  for (const el of $$('.drawer, .sheet')) {
    if (el.id === except) continue;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }
  if (!except) document.body.classList.remove('panel-open');
}
function setTab(name) {
  $('#stage').dataset.active = name;
  $$('.tabbar [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
}
function toggleImmersive() {
  const open = !immersiveOpen();
  document.body.classList.toggle('imm-open', open);
  $('#immersive').setAttribute('aria-hidden', String(!open));
  if (open) requestAnimationFrame(() => lyImm.update(S.player.position()));
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
  showModal(`<div class="modal-card connect glass lit">
    <span class="eyebrow">Spotify Premium</span>
    <h2 class="title" data-text="Connect your account">Connect your account</h2>
    ${error ? `<p class="note error">${esc(error)}</p>` : ''}
    ${!valid ? `<p class="note error">Spotify doesn’t allow <b>localhost</b>. Open <a href="${esc(fixUrl)}">${esc(fixUrl)}</a> instead and connect from there.</p>` : ''}
    <ol class="steps">
      <li>Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a>, log in with your Premium account and press <b>Create app</b>.</li>
      <li>Give it any name and description. Under <b>Redirect URIs</b> paste this exactly, then press <b>Add</b>:
        <div class="copy-row"><code>${esc(uri)}</code><button class="icon-btn" data-copy="${esc(uri)}" aria-label="Copy redirect URI">${icons.copy}</button></div></li>
      <li>Under <b>Which API/SDKs are you planning to use?</b> tick <b>Web API</b> and <b>Web Playback SDK</b>. Accept the terms and <b>Save</b>.</li>
      <li>Open the app’s <b>Settings</b>, copy the <b>Client ID</b> and paste it below.</li>
    </ol>
    <label class="field"><span>Client ID</span><input id="client-id" value="${esc(getClientId())}" placeholder="32 letters and numbers" spellcheck="false" autocomplete="off" /></label>
    <div class="modal-actions">
      <button class="btn primary" data-act="do-login">${icons.link} Connect Spotify</button>
      <button class="btn ghost" data-act="close-modal">${S.player?.mode === 'spotify' ? 'Close' : 'Explore the demo first'}</button>
    </div>
    <p class="fine">Your login stays in this browser. The app never sees your password and has no server.</p>
  </div>`);
}

// ---------- settings ----------
function renderSettings() {
  const s = S.settings;
  const seg = (key, opts) =>
    `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-seg="${key}" data-val="${v}" class="${s[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const slider = (key, label, min, max, step, show = (v) => v) =>
    `<label class="slider"><span>${label}<em>${show(s[key])}</em></span><input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}" /></label>`;
  const toggle = (key, label) =>
    `<label class="toggle"><span>${label}</span><input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''} /><i></i></label>`;
  const color = (key, label) => `<label class="swatch" style="--sw:${s[key]}"><input type="color" data-set="${key}" value="${s[key]}" /><span>${label}</span></label>`;
  const refractOK = supportsRefraction();
  const demo = S.player?.mode !== 'spotify';

  $('#settings-body').innerHTML = `
    <section><p class="eyebrow">Theme</p>
      <div class="presets">${Object.entries(PRESETS)
        .map(
          ([k, p]) => `<button class="preset ${s.preset === k ? 'on' : ''}" data-preset="${k}" style="--p1:${p.c1};--p2:${p.c2};--p3:${p.c3};--pa:${p.bgA};--pb:${p.bgB}">
            <span class="preset-orb"></span><span>${p.label}</span></button>`,
        )
        .join('')}</div>
      ${seg('mode', [['dark', 'Dark'], ['light', 'Light']])}
    </section>
    <section><p class="eyebrow">Colors follow the album art</p>
      ${seg('reactive', [['off', 'Off'], ['background', 'Background'], ['all', 'Everything']])}
      <div class="swatches">${color('c1', 'Accent')}${color('c2', 'Glow')}${color('c3', 'Spark')}${color('bgA', 'Sky')}${color('bgB', 'Depth')}</div>
    </section>
    <section><p class="eyebrow">Glass</p>
      ${slider('refraction', 'Liquid refraction', 0, 120, 1)}
      ${refractOK ? '' : '<p class="fine">Liquid refraction needs Chrome, Edge, Brave, Arc or Opera. Other browsers get frosted glass.</p>'}
      ${slider('blur', 'Frost', 0, 40, 1, (v) => `${v}px`)}
      ${slider('glass', 'Panel solidity', 0.15, 0.95, 0.01, (v) => `${Math.round(v * 100)}%`)}
      ${slider('radius', 'Roundness', 8, 44, 1, (v) => `${v}px`)}
      ${toggle('frames', 'Phone-style rims')}
      ${toggle('tilt', 'Tilt toward the cursor')}
    </section>
    <section><p class="eyebrow">Motion & light</p>
      ${slider('motion', 'Movement', 0, 1.6, 0.05, (v) => (v == 0 ? 'Still' : `${Math.round(v * 100)}%`))}
      ${toggle('light', 'Cursor lighting')}
      ${slider('lightStrength', 'Light strength', 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
      ${toggle('bubbles', 'Floating bubbles')}
      ${slider('bubbleCount', 'Bubble count', 4, 60, 1)}
    </section>
    <section><p class="eyebrow">Titles</p>
      ${seg('titleStyle', [['chrome', 'Chrome'], ['bubbly', 'Bubbly'], ['serif', 'Serif']])}
      <p class="title title-preview" data-text="Liquid Glass">Liquid Glass</p>
    </section>
    <section><p class="eyebrow">Lyrics</p>
      ${seg('lyricsStyle', [['bubbles', 'Bubbles'], ['karaoke', 'Karaoke'], ['glow', 'Glow']])}
      ${slider('lyricSize', 'Lyric size', 0.8, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`)}
    </section>
    <section><p class="eyebrow">Account</p>
      <p class="muted">${demo ? 'You’re in demo mode.' : `Connected as <b>${esc(S.me?.display_name || 'you')}</b>.`}</p>
      <div class="modal-actions">${
        demo
          ? `<button class="btn primary" data-act="connect">${icons.link} Connect Spotify</button>`
          : `<button class="btn ghost" data-act="logout">${icons.logout} Disconnect</button>`
      }</div>
    </section>
    <button class="btn ghost wide" data-act="reset-look">Reset the look</button>`;
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
  const em = el.closest('.slider')?.querySelector('em');
  if (em) {
    const fmts = { blur: (x) => `${x}px`, radius: (x) => `${x}px`, glass: (x) => `${Math.round(x * 100)}%`, lightStrength: (x) => `${Math.round(x * 100)}%`, lyricSize: (x) => `${Math.round(x * 100)}%`, motion: (x) => (x == 0 ? 'Still' : `${Math.round(x * 100)}%`) };
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
  share,
  device: devicePicker,
  'play-here': () => S.player.playHere?.(),
  immersive: toggleImmersive,
  menu: () => {
    renderLibraryHome();
    openPanel('library');
  },
  search: () => openPanel('search'),
  settings: () => openPanel('settings'),
  'close-drawers': () => closePanels(),
  'close-modal': closeModal,
  connect: () => {
    closePanels();
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
  const act = t.closest('[data-act]');
  if (act) return actions[act.dataset.act]?.(act, e);
  const tab = t.closest('[data-tab]');
  if (tab) return setTab(tab.dataset.tab);

  let el;
  if ((el = t.closest('[data-qi]'))) {
    const i = Number(el.dataset.qi);
    const p = S.player;
    if (p.mode === 'demo') return p.play({ tracks: p.queue, index: (p.index + 1 + i) % p.queue.length });
    return p.play({ uris: S.queue.slice(i).map((x) => x.uri) });
  }
  if ((el = t.closest('[data-ci]'))) return playFrom(S.collection.tracks, Number(el.dataset.ci), S.collection.contextUri);
  if (t.closest('[data-coll-play]')) {
    const c = S.collection;
    if (!c.tracks.length && !c.contextUri) return toast('Nothing to play here yet.');
    return playFrom(c.tracks, 0, c.contextUri);
  }
  if ((el = t.closest('[data-si]'))) return playFrom(S.searchTracks, Number(el.dataset.si));
  if ((el = t.closest('[data-ri]'))) return playFrom(S.recent, Number(el.dataset.ri));
  if ((el = t.closest('[data-open-playlist]'))) return openCollection('playlist', el.dataset.openPlaylist);
  if ((el = t.closest('[data-open-album]'))) return openCollection('album', el.dataset.openAlbum);
  if (t.closest('[data-open-liked]')) return openCollection('liked');
  if (t.closest('[data-lib-back]')) return renderLibraryHome();
  if ((el = t.closest('[data-artist]'))) {
    $('#search-input').value = el.dataset.artist;
    return runSearch(el.dataset.artist);
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
    Object.assign(S.settings, PRESETS[k], { preset: k });
    delete S.settings.label;
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#modal').classList.contains('open')) return closeModal();
    if (immersiveOpen()) return toggleImmersive();
    return closePanels();
  }
  if (e.target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space' && !e.target.closest('button, [role="slider"]')) {
    e.preventDefault();
    S.player.toggle();
  } else if (e.key === 'ArrowRight' && !e.target.closest('[role="slider"]')) S.player.seek(S.player.position() + 5000);
  else if (e.key === 'ArrowLeft' && !e.target.closest('[role="slider"]')) S.player.seek(Math.max(0, S.player.position() - 5000));
  else if (e.key.toLowerCase() === 'l') toggleImmersive();
  else if (e.key === '/') {
    e.preventDefault();
    openPanel('search');
  }
});

// ---------- frame loop ----------
let lastSec = -1;
function loop() {
  const p = S.player;
  if (p) {
    const pos = p.position();
    const dur = p.state.duration;
    const frac = dur ? clamp(pos / dur, 0, 1) : 0;
    for (const r of ranges) if (r.kind === 'seek' && !r.dragging) r.el.style.setProperty('--p', frac.toFixed(4));
    const sec = Math.floor(pos / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      if (!ranges.some((r) => r.kind === 'seek' && r.dragging)) $$('.t-pos').forEach((t) => (t.textContent = fmt(pos)));
      $$('.t-dur').forEach((t) => (t.textContent = fmt(dur)));
    }
    if (!immersiveOpen()) lyMain.update(pos);
    else lyImm.update(pos);
  }
  requestAnimationFrame(loop);
}

// ---------- boot ----------
async function startSpotify() {
  wirePlayer(new SpotifyPlayer());
  try {
    S.me = await Spotify.me();
  } catch (e) {
    if (e.status === 401) {
      logout();
      return startDemo('Your Spotify session expired. Please connect again.');
    }
    if (e.status === 403)
      openConnect(
        `Spotify said: “${e.message}”. In your app on the Spotify dashboard, open User Management and add the name and email of your Spotify account, then connect again.`,
      );
    else toast(e.message, 'error');
  }
  if (S.me && S.me.product !== 'premium') toast('This Spotify account isn’t Premium, so songs can’t play inside the browser. You can still browse and see lyrics.', 'warn', 8000);
  loadLibrary();
}

function startDemo(error) {
  const p = new DemoPlayer();
  p.queue = demoTracks();
  p.index = 0;
  p._load(false);
  wirePlayer(p);
  loadLibrary();
  openConnect(error);
}

async function boot() {
  hydrateIcons();
  theme();
  fx.start();
  $('#search-results').innerHTML = '<p class="muted pad">Type to search for songs, artists, albums and playlists.</p>';
  let error;
  try {
    if (await handleCallback()) toast('Connected to Spotify ✦', 'ok');
  } catch (e) {
    error = e.message;
  }
  if (isLoggedIn() && !error) startSpotify();
  else startDemo(error);
  requestAnimationFrame(loop);
}

boot();
