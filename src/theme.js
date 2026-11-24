// Look & feel settings, presets and album-art color extraction.
import { setLensScale } from './lens.js';

export const PRESETS = {
  midnight: { label: 'Midnight', mode: 'dark', c1: '#9fb6ff', c2: '#c7a0ff', c3: '#7ee3cf', bgA: '#1d1d22', bgB: '#09090b' },
  forest: { label: 'Forest', mode: 'dark', c1: '#9be3b5', c2: '#7fd1c7', c3: '#e6d28a', bgA: '#22392f', bgB: '#0b1512' },
  lavender: { label: 'Lavender', mode: 'dark', c1: '#b69cff', c2: '#7cc7ff', c3: '#ff8fd8', bgA: '#3a2d5e', bgB: '#120d1f' },
  ocean: { label: 'Ocean', mode: 'dark', c1: '#5ccbff', c2: '#00ffd0', c3: '#5b6bff', bgA: '#0e2f45', bgB: '#03101d' },
  sunset: { label: 'Sunset', mode: 'dark', c1: '#ffab73', c2: '#ff5c8a', c3: '#ffd36e', bgA: '#4a1e33', bgB: '#160810' },
  daylight: { label: 'Daylight', mode: 'light', c1: '#5b5bff', c2: '#ff5c9e', c3: '#19b38c', bgA: '#f4f4f7', bgB: '#d9d9e2' },
};

export const DEFAULTS = {
  v: 4,
  preset: 'midnight',
  ...PRESETS.midnight,
  reactive: 'all', // 'off' | 'background' | 'all': colors follow the album art
  backdrop: 'art', // 'art' = the cover melts into the whole background, 'aurora' = soft color glow
  cover: 'melt', // 'melt' = cover dissolves into the background, 'frame' = rounded card
  blur: 7, // px of frosting behind the glass (low = clear glass, so the refraction shows)
  refraction: 70, // how strongly glass edges bend what's behind them (0 = off)
  glass: 0.5, // how solid the glass looks (0..1)
  radius: 28, // corner roundness of cards
  tilt: true, // covers and cards tilt toward the mouse
  bubbles: false, // floating soap bubbles in the background
  bubbleCount: 14,
  motion: 1, // 0 = still, 1 = normal, 1.6 = extra
  light: true, // light that follows the cursor across glass
  lightStrength: 0.55,
  titleStyle: 'clean', // 'clean' | 'chrome' | 'bubbly' | 'serif'
  lyricsStyle: 'bubbles', // 'bubbles' | 'karaoke' | 'glow'
  lyricAlign: 'left', // 'left' (like Apple Music) | 'center'
  inAppPlayback: true, // Android: play inside Spotifier instead of through the Spotify app
  // ---- app settings (You tab) ----
  playOn: 'here', // 'here' = start music on this device, 'active' = on whatever device is already playing
  skipExplicit: false,
  wordSync: true, // light lyrics up word by word (off = whole line at once)
  keepAwake: true, // keep the screen on in full-screen lyrics
  showArtist: true, // "About the artist" in Now Playing
  doubleTapLike: true,
  swipeSkip: true, // swipe the mini player to skip
  haptics: true,
  dataSaver: false, // smaller covers, still backdrop
  lyricSize: 1,
};

const KEY = 'spotifier.settings';

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // Settings from the first version: keep the colors, take the new cleaner defaults for the rest
    if (saved.v === 3) {
      const { v, refraction, blur, glass, ...keep } = saved;
      return { ...DEFAULTS, ...keep, v: DEFAULTS.v };
    }
    if (saved.v !== DEFAULTS.v) {
      const { lyricsStyle, lyricSize } = saved;
      return { ...DEFAULTS, ...(lyricsStyle ? { lyricsStyle } : {}), ...(lyricSize ? { lyricSize } : {}) };
    }
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

export const supportsRefraction = () =>
  !!navigator.userAgentData?.brands?.some((b) => /Chrom/i.test(b.brand)) ||
  (/Chrome\//.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent));

/** Returns the colors actually in use: UI accents and background aurora. */
export function effectiveColors(s, palette) {
  const own = [s.c1, s.c2, s.c3];
  const pal = palette?.length === 3 ? palette : null;
  return {
    ui: s.reactive === 'all' && pal ? pal : own,
    aurora: s.reactive !== 'off' && pal ? pal : own,
  };
}

export function applyTheme(s, palette) {
  const root = document.documentElement;
  const { ui, aurora } = effectiveColors(s, palette);
  const set = (k, v) => root.style.setProperty(k, v);
  ui.forEach((c, i) => set(`--c${i + 1}`, c));
  aurora.forEach((c, i) => set(`--a${i + 1}`, c));
  set('--bgA', s.bgA);
  set('--bgB', s.bgB);
  set('--blur', `${s.blur}px`);
  set('--glass', s.glass);
  set('--radius', `${s.radius}px`);
  set('--motion', s.motion);
  set('--light', s.light ? s.lightStrength : 0);
  set('--lyric-size', s.lyricSize);
  root.dataset.mode = s.mode;
  root.dataset.title = s.titleStyle;
  root.dataset.lyrics = s.lyricsStyle;
  root.dataset.align = s.lyricAlign;
  root.dataset.backdrop = s.backdrop;
  root.dataset.cover = s.cover;
  root.dataset.tilt = s.tilt && s.motion > 0 ? 'on' : 'off';
  root.dataset.bubbles = s.bubbles ? 'on' : 'off';
  root.toggleAttribute('data-still', Number(s.motion) === 0);
  root.classList.toggle('refract', s.refraction > 0 && supportsRefraction());
  setLensScale(s.refraction);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.mode === 'light' ? s.bgA : s.bgB);
  return { ui, aurora };
}

// ---------- palette extraction ----------

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const paletteCache = new Map();

/** Pulls three vivid, distinct colors out of an album cover. */
export async function extractPalette(url) {
  if (!url) return null;
  if (paletteCache.has(url)) return paletteCache.get(url);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const N = 48;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, N, N);
  let data;
  try {
    data = g.getImageData(0, 0, N, N).data;
  } catch {
    return null; // image server didn't allow reading pixels
  }
  const bins = Array.from({ length: 18 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const w = s * s * (1 - Math.abs(l - 0.5) * 1.6) + 0.002;
    if (w <= 0) continue;
    const b = bins[Math.floor(h * 18) % 18];
    b.w += w; b.h += h * w; b.s += s * w; b.l += l * w;
  }
  const ranked = bins
    .map((b, i) => ({ i, w: b.w, h: b.w ? b.h / b.w : 0, s: b.w ? b.s / b.w : 0, l: b.w ? b.l / b.w : 0 }))
    .sort((a, b) => b.w - a.w);
  const picks = [];
  for (const b of ranked) {
    if (b.w < 0.02) break;
    if (picks.every((p) => Math.min(Math.abs(p.i - b.i), 18 - Math.abs(p.i - b.i)) >= 2)) picks.push(b);
    if (picks.length === 3) break;
  }
  if (!picks.length) picks.push({ h: 0.72, s: 0.5, l: 0.6 }); // grey cover → lavender
  while (picks.length < 3) {
    const base = picks[0];
    picks.push({ h: (base.h + (picks.length === 1 ? 0.12 : -0.12) + 1) % 1, s: base.s, l: base.l });
  }
  const out = picks.map((p) => hslToHex(p.h, Math.max(0.6, Math.min(0.95, p.s * 1.3)), Math.max(0.58, Math.min(0.72, p.l + 0.12))));
  paletteCache.set(url, out);
  return out;
}

const brightCache = new Map();
/**
 * How bright a cover is where text sits over it (its lower half), 0..1.
 * Used to make the glass a bit darker over bright covers so titles stay readable,
 * the way iOS glass adapts to what's behind it.
 */
export async function artBrightness(url) {
  if (!url) return 0;
  if (brightCache.has(url)) return brightCache.get(url);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  let v = 0;
  try {
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = cv.height = 24;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 8, 24, 16).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    v = sum / (d.length / 4);
  } catch {
    v = 0;
  }
  brightCache.set(url, v);
  return v;
}
