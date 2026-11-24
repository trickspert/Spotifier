// Liquid Glass lens: real edge refraction for glass buttons and bars (Chromium / Android WebView).
//
// For every glass element (class "lg") we build an SVG displacement map shaped like that
// element: clear in the middle, and toward the rim the backdrop is pulled inward, like light
// bending through the thick rounded edge of a glass lens. The map is used as a
// backdrop-filter, so whatever scrolls or moves behind the glass warps at its edges.

const cache = new Map(); // "WxH r" -> filter id
let defs;
let scale = 45;
let enabled = true;

function lensMap(W, H, r) {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const bezel = Math.max(6, Math.min(r * 0.75, 26));
  const hw = W / 2, hh = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      // signed distance to a rounded rectangle (negative inside)
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const outLen = Math.hypot(ox, oy);
      const dist = -(outLen + Math.min(Math.max(qx, qy), 0) - r); // distance from edge, inside > 0
      let dx = 0, dy = 0;
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
        const t = 1 - Math.max(0, dist) / bezel; // 1 at the rim, 0 where the bezel ends
        const m = t * t * (3 - 2 * t);
        dx = -nx * m; // sample toward the center
        dy = -ny * m;
      }
      const i = (y * W + x) * 4;
      d[i] = 128 + dx * 127;
      d[i + 1] = 128 + dy * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

function filterFor(W, H, r) {
  const key = `${W}x${H}r${r}`;
  if (cache.has(key)) return cache.get(key);
  const id = `lens-${cache.size}`;
  defs.insertAdjacentHTML(
    'beforeend',
    `<filter id="${id}" x="0" y="0" width="${W}" height="${H}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feImage href="${lensMap(W, H, r)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" result="map"/>
      <feDisplacementMap data-lens in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`,
  );
  cache.set(key, id);
  return id;
}

function apply(el) {
  if (!enabled) return;
  const w = el.offsetWidth, h = el.offsetHeight;
  if (w < 8 || h < 8 || w * h > 900_000) return; // skip hidden or huge elements
  // round sizes so similar elements share a filter
  const W = Math.round(w / 2) * 2, H = Math.round(h / 2) * 2;
  const cs = getComputedStyle(el);
  let r = parseFloat(cs.borderTopLeftRadius) || 0;
  if (cs.borderTopLeftRadius.endsWith('%')) r = (Math.min(W, H) * parseFloat(cs.borderTopLeftRadius)) / 100;
  r = Math.min(r, W / 2, H / 2);
  const id = filterFor(W, H, Math.round(r));
  el.style.setProperty('--lens', `url(#${id})`);
}

export function initLens({ refraction, supported }) {
  defs = document.querySelector('.svg-defs');
  scale = refraction;
  enabled = supported;
  if (!enabled || !defs) return;
  const ro = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target)));
  const watch = (root) => {
    if (root.nodeType !== 1) return;
    if (root.classList.contains('lg')) ro.observe(root);
    root.querySelectorAll?.('.lg').forEach((el) => ro.observe(el));
  };
  watch(document.body);
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach(watch))).observe(document.body, { childList: true, subtree: true });
}
