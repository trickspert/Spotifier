export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fmt(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

let toastTimer;
export function toast(message, kind = 'info', ms = 3800) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'lg toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.dataset.kind = kind;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;
const stroke = (d) =>
  svg(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);

export const icons = {
  play: svg('<path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.7.94l10.1-6.4a1.1 1.1 0 0 0 0-1.88L9.7 4.66A1.1 1.1 0 0 0 8 5.6z" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/>'),
  next: svg('<path d="M5.5 6.3v11.4a1 1 0 0 0 1.6.8l7.6-5.7a1 1 0 0 0 0-1.6L7.1 5.5a1 1 0 0 0-1.6.8z" fill="currentColor"/><rect x="16.2" y="5" width="2.6" height="14" rx="1.3" fill="currentColor"/>'),
  prev: svg('<path d="M18.5 6.3v11.4a1 1 0 0 1-1.6.8l-7.6-5.7a1 1 0 0 1 0-1.6l7.6-5.7a1 1 0 0 1 1.6.8z" fill="currentColor"/><rect x="5.2" y="5" width="2.6" height="14" rx="1.3" fill="currentColor"/>'),
  shuffle: stroke('M3 7h3.5c2 0 3.2 1 4.3 2.6l2.4 4.8C14.3 16 15.5 17 17.5 17H21M18 14l3 3-3 3M3 17h3.5c1.2 0 2.1-.4 2.9-1.1M13.6 8.1C14.4 7.4 15.3 7 16.5 7H21M18 4l3 3-3 3'),
  repeat: stroke('M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4'),
  repeatOne: stroke('M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4M11.5 10.2l1.3-.9V15'),
  volume: stroke('M11 5 6.5 9H3v6h3.5L11 19V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'),
  mute: stroke('M11 5 6.5 9H3v6h3.5L11 19V5zM22 9l-6 6M16 9l6 6'),
  lyrics: stroke('M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5zM8 8h8M8 11.5h5'),
  expand: svg('<path d="M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5l-5.75 5.75M4.5 19.5l5.75-5.75" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  close: stroke('M6 6l12 12M18 6 6 18'),
  home: stroke('M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'),
  search: stroke('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.6-4.6'),
  library: stroke('M4 4v16M9 4v16M14 4.5l5.5 15'),
  heart: svg('<path d="M12 20.5s-7.5-4.6-9.3-9.4C1.3 7.3 3.7 4 7.1 4c2 0 3.6 1.1 4.9 2.9C13.3 5.1 14.9 4 16.9 4c3.4 0 5.8 3.3 4.4 7.1-1.8 4.8-9.3 9.4-9.3 9.4z" fill="currentColor"/>'),
  sliders: stroke('M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4'),
  sparkle: svg('<path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" fill="currentColor"/>'),
  back: stroke('M15 5l-7 7 7 7'),
  logout: stroke('M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10'),
  device: stroke('M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 20h8M12 16v4'),
  copy: stroke('M9 9h10v11H9zM5 15V4h10'),
  link: stroke('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
  forward: svg('<path d="M3.5 6.6v10.8a1 1 0 0 0 1.55.83L12 13.6v3.8a1 1 0 0 0 1.55.83l8-5.4a1 1 0 0 0 0-1.66l-8-5.4A1 1 0 0 0 12 6.6v3.8L5.05 5.77A1 1 0 0 0 3.5 6.6z" fill="currentColor"/>'),
  grid: stroke('M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z'),
  heartOutline: stroke('M12 20.5s-7.5-4.6-9.3-9.4C1.3 7.3 3.7 4 7.1 4c2 0 3.6 1.1 4.9 2.9C13.3 5.1 14.9 4 16.9 4c3.4 0 5.8 3.3 4.4 7.1-1.8 4.8-9.3 9.4-9.3 9.4z'),
  user: stroke('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5'),
  chevronDown: stroke('M6 9.5l6 6 6-6'),
  more: svg('<circle cx="5.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor"/>'),
  share: stroke('M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7'),
  chevronRight: stroke('M9.5 6l6 6-6 6'),
  queue: stroke('M4 6h11M4 11h11M4 16h7M17 13v7M17 20a2 2 0 1 0 0-.01M17 13l4-1.5'),
  clock: stroke('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2'),
  moon: stroke('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'),
  music: stroke('M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'),
};

/** An equalizer animation shown next to the playing track. */
export const eqBars = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
