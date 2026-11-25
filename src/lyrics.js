// Lyrics: fetched at runtime from LRCLIB (https://lrclib.net), a free, open lyrics
// database with time-synced lyrics. Spotify doesn't offer lyrics to third-party apps.
// Rendered as floating glass bubbles (or karaoke fill) that light up in time with the song.
import { esc } from './util.js';
import { lensFor } from './lens.js';

const cache = new Map();

const stampMs = (m, s) => (Number(m) * 60 + Number(String(s).replace(':', '.'))) * 1000;

export function parseLRC(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const body = raw.replace(/\[[^\]]*\]/g, '');
    // word-level timing, e.g. "<00:12.30> hello <00:12.80> world"
    let words = null;
    if (/<\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?>/.test(body)) {
      words = [];
      for (const m of body.matchAll(/<(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)>([^<]*)/g)) {
        for (const w of m[3].trim().split(/\s+/).filter(Boolean)) words.push({ text: w, s: stampMs(m[1], m[2]) });
      }
    }
    const line = body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    for (const m of stamps) {
      const t = stampMs(m[1], m[2]);
      out.push({ t, text: line || '♪', words: words?.length ? words : null });
    }
  }
  out.sort((a, b) => a.t - b.t);
  // Merge back-to-back instrumental markers
  return out.filter((l, i) => !(l.text === '♪' && out[i - 1]?.text === '♪'));
}

/**
 * Estimates the beat length (ms) from when lines start: sung lines usually begin on the bar,
 * so the typical gap between lines is a bar (or two). We fold it into a 4/4 beat at 70-170 BPM.
 */
export function estimateBeat(lines) {
  const gaps = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const g = lines[i + 1].t - lines[i].t;
    if (g > 700 && g < 12000 && lines[i].text !== '♪') gaps.push(g);
  }
  if (gaps.length < 4) return 500;
  gaps.sort((a, b) => a - b);
  let bar = gaps[gaps.length >> 1];
  while (bar > 4400) bar /= 2;
  while (bar < 1400) bar *= 2;
  let beat = bar / 4;
  while (60000 / beat < 70) beat /= 2;
  while (60000 / beat > 170) beat *= 2;
  return beat;
}

const syllables = (w) => Math.max(1, (w.toLowerCase().match(/[aeiouyàâäéèêëîïôöùûüœæ]+/g) || []).length);

/** Start/end time (ms) of every word in a line: exact if the lyrics have it, otherwise estimated. */
function timeWords(line, next, beat) {
  const end = next ?? line.t + 4000;
  if (line.words) {
    return line.words.map((w, i) => ({ s: w.s, e: Math.max(w.s + 120, line.words[i + 1]?.s ?? Math.min(end, w.s + beat * 2)) }));
  }
  const words = line.text.split(/\s+/).filter(Boolean);
  if (!words.length || line.text === '♪') return [];
  const syl = words.map(syllables);
  const total = syl.reduce((a, b) => a + b, 0);
  const gap = end - line.t;
  // roughly one syllable per eighth note, but always finish a little before the next line
  const sing = Math.min(gap * 0.92, Math.max(gap * 0.5, total * (beat / 2)));
  const grid = beat / 4; // snap word starts to sixteenth notes, so highlights land on the rhythm
  let acc = 0;
  let last = line.t;
  return words.map((w, i) => {
    let st = line.t + (sing * acc) / total;
    st = Math.max(last, line.t + Math.round((st - line.t) / grid) * grid);
    acc += syl[i];
    const en = Math.max(st + 90, line.t + (sing * acc) / total);
    last = st;
    return { s: st, e: en };
  });
}

async function lrclib(path) {
  const res = await fetch(`https://lrclib.net/api/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Lyrics service error (${res.status})`);
  return res.json();
}

/** Returns { synced: bool, lines: [{t, text}] } or { lines: [] } when none were found. */
export async function getLyrics(track) {
  if (!track) return { lines: [] };
  if (track.lyrics) return { synced: true, lines: track.lyrics };
  if (cache.has(track.id)) return cache.get(track.id);

  const artist = track.artistList?.[0] || track.artists;
  const p = new URLSearchParams({
    track_name: track.name,
    artist_name: artist,
    album_name: track.album || '',
    duration: Math.round(track.duration / 1000),
  });
  let hit = await lrclib(`get?${p}`).catch(() => null);
  if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
    const s = new URLSearchParams({ track_name: track.name, artist_name: artist });
    const list = (await lrclib(`search?${s}`)) || [];
    const close = list.filter((x) => Math.abs((x.duration || 0) - track.duration / 1000) < 8);
    hit = close.find((x) => x.syncedLyrics) || list.find((x) => x.syncedLyrics) || close[0] || list[0];
  }
  let result = { lines: [] };
  if (hit?.instrumental) result = { synced: false, instrumental: true, lines: [] };
  else if (hit?.syncedLyrics) result = { synced: true, lines: parseLRC(hit.syncedLyrics) };
  else if (hit?.plainLyrics)
    result = { synced: false, lines: hit.plainLyrics.split(/\r?\n/).map((text) => ({ t: -1, text: text.trim() })).filter((l) => l.text) };
  cache.set(track.id, result);
  return result;
}


/**
 * Synced lyrics with ONE real liquid-glass bubble that glides from line to line,
 * stretching to fit each line (like the sliding glass pill in iOS tab bars).
 * The bubble sits over the sung line, so the words are magnified and bent at its rim,
 * while their colors shift underneath.
 */
export class LyricsView {
  /**
   * @param {HTMLElement} el container
   * @param {(ms:number)=>void} onSeek called when a line is tapped
   * @param {(index:number)=>void} onLine called when the active line changes
   */
  constructor(el, { onSeek, onLine } = {}) {
    this.el = el;
    this.onSeek = onSeek;
    this.onLine = onLine;
    el.classList.add('lyrics');
    el.innerHTML = '<div class="lyrics-track"></div>';
    this.track = el.firstElementChild;
    this.glass = document.createElement('div');
    this.glass.className = 'lyric-glass lg lg-manual';
    this.glass.setAttribute('aria-hidden', 'true');
    this.lines = [];
    this.nodes = [];
    this.active = -2;
    this.synced = false;
    this.manual = 0; // extra scroll offset from the mouse wheel / finger
    this.manualUntil = 0;
    this.lastP = -1;
    this.box = null;
    this.glassReq = 0;
    this.offset = 0; // lyric timing adjustment (ms), set per song by the user
    this.wordSync = true; // false = light the whole line at once
    this.timing = []; // per line: [{s, e}] for each word
    this.wIdx = -1;
    this.lastWp = -1;
    this.beat = 500;

    this.track.addEventListener('click', (e) => {
      const b = e.target.closest('.lyric');
      if (!b || !this.synced) return;
      const line = this.lines[Number(b.dataset.i)];
      if (line?.t >= 0) {
        this.manual = 0;
        this.onSeek?.(line.t);
      }
    });
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.synced) return;
        e.preventDefault();
        this.manual -= e.deltaY;
        this.manualUntil = performance.now() + 3500;
        this._center(true);
      },
      { passive: false },
    );
    // swipe to look around; it snaps back to the sung line after a moment
    let startY = null, startManual = 0;
    el.addEventListener('touchstart', (e) => {
      if (!this.synced) return;
      startY = e.touches[0].clientY;
      startManual = this.manual;
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (startY == null) return;
      this.manual = startManual + (e.touches[0].clientY - startY);
      this.manualUntil = performance.now() + 3500;
      this._center(true);
    }, { passive: true });
    el.addEventListener('touchend', () => (startY = null), { passive: true });

    new ResizeObserver(() => {
      this._center(true);
      if (this.active >= 0) this._placeGlass(this.active, true);
    }).observe(el);
  }

  status(html) {
    this.lines = [];
    this.nodes = [];
    this.synced = false;
    this.active = -2;
    this.box = null;
    this.glass.classList.remove('on');
    this.glass.remove();
    this.el.classList.remove('synced', 'plain');
    this.track.style.transform = '';
    this.track.innerHTML = `<div class="lyrics-status">${html}</div>`;
  }

  set({ lines, synced }) {
    this.lines = lines;
    this.synced = !!synced;
    this.active = -2;
    this.manual = 0;
    this.box = null;
    this.el.classList.toggle('synced', this.synced);
    this.el.classList.toggle('plain', !this.synced);
    this.track.style.transform = '';
    this.beat = this.synced ? estimateBeat(lines) : 500;
    this.el.style.setProperty('--beat', `${Math.round(this.beat)}ms`);
    this.timing = this.synced ? lines.map((l, i) => timeWords(l, lines[i + 1]?.t, this.beat)) : [];
    this.wIdx = -1;
    this.track.innerHTML = lines
      .map((l, i) => {
        const spans = l.text
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => `<span class="w">${esc(w)}</span>`)
          .join(' ');
        const inst = l.text === '♪' ? ' inst' : '';
        return `<button class="lyric${inst}" data-i="${i}" style="--i:${i}" tabindex="-1"><span class="lyric-text">${inst ? '<span class="dots"><i></i><i></i><i></i></span>' : spans}</span></button>`;
      })
      .join('');
    this.nodes = [...this.track.children];
    this.glass.classList.remove('on');
    if (this.synced) this.el.append(this.glass);
    else {
      this.glass.remove();
      this.nodes.forEach((n) => n.style.setProperty('--d', 0));
    }
  }

  setOffset(ms) {
    this.offset = ms;
  }

  setWordSync(on) {
    this.wordSync = on;
  }

  update(pos) {
    if (!this.synced || !this.lines.length) return;
    pos += this.offset;
    let i = this.active >= 0 && this.lines[this.active].t <= pos ? this.active : -1;
    while (i + 1 < this.lines.length && this.lines[i + 1].t <= pos) i++;
    if (i !== this.active) {
      const prev = this.active;
      if (prev >= 0) this.nodes[prev]?.querySelectorAll('.w').forEach((w) => w.classList.add('sung'));
      this.active = i;
      this.lastP = -1;
      this.wIdx = -1;
      this.lastWp = -1;
      this.words = i >= 0 ? [...this.nodes[i].querySelectorAll('.w')] : [];
      this.words.forEach((w) => w.classList.remove('sung', 'now'));
      if (!this.wordSync) this.words.forEach((w) => w.classList.add('now'));
      this.nodes.forEach((n, k) => {
        n.classList.toggle('active', k === i);
        n.classList.toggle('past', k < i);
        n.classList.toggle('next', k === i + 1);
        n.style.setProperty('--d', Math.min(6, Math.abs(k - Math.max(i, 0))));
        if (k !== i) n.style.removeProperty('--p');
      });
      if (performance.now() > this.manualUntil) this.manual = 0;
      this._center(false);
      this._placeGlass(i, prev < 0);
      if (prev !== -2 && i >= 0) this.onLine?.(i);
    }
    if (i >= 0) {
      const start = this.lines[i].t;
      const end = this.lines[i + 1]?.t ?? start + 4000;
      const p = Math.min(1, (pos - start) / Math.max(400, (end - start) * 0.88));
      // only touch the DOM when the fill visibly moves
      if (Math.abs(p - this.lastP) > 0.012 || p === 1) {
        this.lastP = p;
        this.nodes[i].style.setProperty('--p', p.toFixed(3));
      }
      // word-by-word highlight
      const wt = this.timing[i];
      if (this.wordSync && wt?.length && this.words?.length) {
        let w = this.wIdx;
        while (w + 1 < wt.length && wt[w + 1].s <= pos) w++;
        if (w !== this.wIdx) {
          for (let k = Math.max(0, this.wIdx); k < w; k++) {
            this.words[k]?.classList.remove('now');
            this.words[k]?.classList.add('sung');
          }
          const cur = this.words[w];
          if (cur) {
            // brighten over the word's own length (soft, never a hard flash)
            const dur = Math.round(Math.min(650, Math.max(180, wt[w].e - wt[w].s)));
            cur.style.transitionDuration = `${dur}ms, 1400ms`;
            cur.classList.add('now');
          }
          this.wIdx = w;
        }
      }
    }
    if (this.manual && performance.now() > this.manualUntil) {
      this.manual = 0;
      this._center(false);
    }
  }

  /** Where the sung line's middle sits in the box (the bubble stays here; lines flow into it). */
  _anchor() {
    return this.el.clientHeight * 0.42;
  }

  /** Resizes the anchored glass bubble to fit line i (FLIP, so it morphs smoothly). */
  async _placeGlass(i, instant) {
    const n = this.nodes[i];
    const g = this.glass;
    if (!n || !n.offsetWidth || n.classList.contains('inst') || this.manual) {
      g.classList.remove('on');
      return;
    }
    const w = n.offsetWidth, h = n.offsetHeight;
    const box = { x: this.track.offsetLeft + n.offsetLeft, y: Math.round(this._anchor() - h / 2), w, h };
    const r = Math.min(h / 2, 30);
    const my = ++this.glassReq;
    // get the lens map ready first so the glass never shows a half-loaded frame
    const id = await lensFor(w, h, r, { k: 0.2, disperse: false, round: 12 }).catch(() => null);
    if (my !== this.glassReq) return;
    const prev = g.classList.contains('on') ? this.box : null;
    this.box = box;
    g.style.width = `${w}px`;
    g.style.height = `${h}px`;
    g.style.borderRadius = `${r}px`;
    if (id) g.style.setProperty('--lens', `url(#${id})`);
    const to = `translate3d(${box.x}px, ${box.y}px, 0)`;
    g.style.transition = 'none';
    g.style.transform = prev && !instant ? `translate3d(${prev.x}px, ${prev.y}px, 0) scale(${prev.w / w}, ${prev.h / h})` : to;
    g.getBoundingClientRect();
    g.style.transition = '';
    g.style.transform = to;
    g.classList.add('on');
  }

  _center(instant) {
    if (!this.synced || !this.nodes.length) return;
    const a = this.nodes[Math.max(0, this.active)];
    const base = this._anchor() - (a.offsetTop + a.offsetHeight / 2);
    // hide the bubble while you look around by hand; bring it back when lyrics snap back
    if (this.manual) this.glass.classList.remove('on');
    else if (this.active >= 0 && !this.glass.classList.contains('on') && !instant) this._placeGlass(this.active, true);
    this.track.classList.toggle('instant', !!instant);
    this.track.style.transform = `translate3d(0, ${Math.round(base + this.manual)}px, 0)`;
  }
}

export function clearLyricsCache() {
  cache.clear();
}
