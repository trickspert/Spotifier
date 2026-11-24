// Liquid Glass lens: real refraction for glass buttons, bars and cards (Chromium / Android WebView).
//
// For each glass element (class "lg") we build a displacement map shaped like that element:
//  - a thick, curved rim that bends the backdrop strongly toward the center (like a glass edge)
//  - a slight magnification across the middle (like looking through a lens)
// Small elements (buttons, bars) also split red/green/blue a little at the rim, the faint
// rainbow edge real glass has. The map is applied with backdrop-filter, so whatever moves
// behind the glass warps live.
//
// Maps are fully decoded BEFORE an element switches to them. Switching to a map that hasn't
// loaded yet makes the glass smear for a frame, which is the "blob" glitch.

const ready = new Map(); // key -> Promise<filter id>
let defs;
let scale = 70;
let enabled = true;
let counter = 0;

function lensMap(W, H, r) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const bezel = Math.max(6, Math.min(r * 0.6, 22, Math.min(W, H) * 0.4));
  const hw = W / 2, hh = H / 2;
  const mag = 0.05; // center magnification
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const outLen = Math.hypot(ox, oy);
      const dist = -(outLen + Math.min(Math.max(qx, qy), 0) - r); // distance from the edge (inside > 0)
      // gentle magnification everywhere: sample a little closer to the center
      let dx = (-px / hw) * mag, dy = (-py / hh) * mag;
      if (dist < bezel) {
        let nx, ny;
        if (qx > 0 && qy > 0 && outLen > 0) {
          nx = ox / outLen;
          ny = oy / outLen;
        } else if (qx > qy) {
          nx = 1; ny = 0;
        } else {
          nx = 0; ny = 1;
        }
        nx *= Math.sign(px) || 1;
        ny *= Math.sign(py) || 1;
        // curved-glass profile: slope of a quarter circle, steep at the rim, flat inside
        const t = Math.min(1, Math.max(0, dist) / bezel); // 0 at the rim, 1 where the bezel ends
        const m = 1 - Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
        const k = Math.min(1, (1 - t) * 0.35 + m * 0.9);
        dx -= nx * k;
        dy -= ny * k;
      }
      const i = (y * W + x) * 4;
      d[i] = Math.max(0, Math.min(255, 128 + dx * 127));
      d[i + 1] = Math.max(0, Math.min(255, 128 + dy * 127));
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

/**
 * Returns (once it's fully loaded) the id of a lens filter for a W×H element with corner radius r.
 * opts.k scales the strength (text needs a much gentler lens than buttons); opts.disperse
 * turns the rainbow rim on or off (default: on for small elements).
 */
export function lensFor(W, H, r, opts = {}) {
  defs ||= document.querySelector('.svg-defs');
  W = Math.max(8, Math.round(W / 2) * 2);
  H = Math.max(8, Math.round(H / 2) * 2);
  r = Math.round(Math.min(r, W / 2, H / 2));
  const k0 = (opts.k ?? 1) * (Math.min(W, H) < 32 ? 0.4 : 1);
  const tiny = Math.min(W, H) < 32; // e.g. the slider knob: soft lens, no rainbow
  const disperse = !tiny && (opts.disperse ?? W * H < 90_000); // faint rainbow rim only on buttons and bars
  const key = `${W}x${H}r${r}k${k0}${disperse ? 'd' : ''}`;
  if (ready.has(key)) return ready.get(key);
  const p = (async () => {
    const url = lensMap(W, H, r);
    const pre = new Image();
    pre.src = url;
    await pre.decode().catch(() => {});
    const id = `lens-${counter++}`;
    const map = `<feImage href="${url}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" result="map"/>`;
    const disp = (k, res) =>
      `<feDisplacementMap data-lens data-k="${k * k0}" in="SourceGraphic" in2="map" scale="${scale * k * k0}" xChannelSelector="R" yChannelSelector="G" result="${res}"/>`;
    const body = disperse
      ? `${map}${disp(1.018, 'dr')}${disp(1, 'dg')}${disp(0.982, 'db')}
         <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r"/>
         <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g"/>
         <feColorMatrix in="db" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b"/>
         <feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>`
      : `${map}${disp(1, 'out')}`;
    defs.insertAdjacentHTML(
      'beforeend',
      `<filter id="${id}" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${body}</filter>`,
    );
    return id;
  })();
  ready.set(key, p);
  return p;
}

function radiusOf(el, W, H) {
  const v = getComputedStyle(el).borderTopLeftRadius;
  return v.endsWith('%') ? (Math.min(W, H) * parseFloat(v)) / 100 : parseFloat(v) || 0;
}

async function apply(el) {
  if (!enabled) return;
  const W = el.offsetWidth, H = el.offsetHeight;
  if (W < 8 || H < 8 || W * H > 1_200_000) return;
  const want = `${W}x${H}`;
  el.dataset.lensWant = want;
  const id = await lensFor(W, H, radiusOf(el, W, H));
  if (el.dataset.lensWant === want) el.style.setProperty('--lens', `url(#${id})`); // keep the old map until the new one is ready
}

/** Updates every lens when the refraction slider moves. */
export function setLensScale(s) {
  scale = s;
  defs?.querySelectorAll('feDisplacementMap[data-lens]').forEach((m) => m.setAttribute('scale', String(s * Number(m.dataset.k || 1))));
}

export function initLens({ refraction, supported }) {
  defs = document.querySelector('.svg-defs');
  scale = refraction;
  enabled = supported;
  if (!enabled || !defs) return;
  const ro = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target)));
  const watch = (root) => {
    if (root.nodeType !== 1) return;
    if (root.classList.contains('lg') && !root.classList.contains('lg-manual')) ro.observe(root);
    root.querySelectorAll?.('.lg:not(.lg-manual)').forEach((el) => ro.observe(el));
  };
  watch(document.body);
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(watch))).observe(document.body, { childList: true, subtree: true });
}
