// Look & feel settings, presets and album-art color extraction.

export const PRESETS = {
  lavender: { label: 'Lavender Liquid', mode: 'dark', c1: '#b69cff', c2: '#7cc7ff', c3: '#ff8fd8', bgA: '#7a62a8', bgB: '#3d2f63' },
  aurora: { label: 'Aurora', mode: 'dark', c1: '#9d8cff', c2: '#00e0c6', c3: '#ff5ca8', bgA: '#1d1846', bgB: '#060512' },
  neon: { label: 'Neon Night', mode: 'dark', c1: '#ff5ce1', c2: '#22e6ff', c3: '#8a4dff', bgA: '#2c0b44', bgB: '#05010d' },
  pastel: { label: 'Pastel Dream', mode: 'light', c1: '#7c4dff', c2: '#ff7cc0', c3: '#3fcfab', bgA: '#eadfff', bgB: '#bfaee8' },
  ocean: { label: 'Deep Ocean', mode: 'dark', c1: '#5ccbff', c2: '#00ffd0', c3: '#5b6bff', bgA: '#0b3752', bgB: '#03101d' },
  sunset: { label: 'Sunset Glass', mode: 'dark', c1: '#ffab73', c2: '#ff5c8a', c3: '#ffd36e', bgA: '#5c2341', bgB: '#190711' },
};

export const DEFAULTS = {
  preset: 'lavender',
  ...PRESETS.lavender,
  reactive: 'background', // 'off' | 'background' | 'all' — follow the album art colors
  blur: 18, // px of frosting
  refraction: 40, // liquid-glass bending strength (0 = off)
  glass: 0.62, // how solid the panels are (0..1)
  radius: 30, // corner roundness
  frames: true, // phone-style rims around the panels
  tilt: true, // panels/cards tilt toward the cursor
  bubbles: true,
  bubbleCount: 26,
  motion: 1, // 0 = still, 1 = normal, 1.6 = extra
  light: true, // cursor lighting
  lightStrength: 0.7,
  titleStyle: 'chrome', // 'chrome' | 'bubbly' | 'serif'
  lyricsStyle: 'bubbles', // 'bubbles' | 'karaoke' | 'glow'
  lyricSize: 1,
};

const KEY = 'spotifier.settings';

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
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
  root.dataset.frames = s.frames ? 'on' : 'off';
  root.dataset.tilt = s.tilt && s.motion > 0 ? 'on' : 'off';
  root.toggleAttribute('data-still', Number(s.motion) === 0);
  root.classList.toggle('refract', s.refraction > 0 && supportsRefraction());
  const map = document.getElementById('refract-map');
  if (map) map.setAttribute('scale', String(s.refraction));
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
