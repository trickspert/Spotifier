// Renders Spotifier's app icon and splash screens into the Android project.
// Usage: node scripts/android-assets.cjs   (needs Playwright with Chromium installed)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

// The glass orb: a glossy bubble with a soft waveform inside (original artwork)
const orb = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <radialGradient id="body" cx="38%" cy="30%" r="78%">
      <stop offset="0" stop-color="#5a5a64"/>
      <stop offset=".45" stop-color="#2c2c33"/>
      <stop offset="1" stop-color="#121215"/>
    </radialGradient>
    <radialGradient id="ember" cx="70%" cy="78%" r="55%">
      <stop offset="0" stop-color="#d42d3a" stop-opacity=".95"/>
      <stop offset="1" stop-color="#d42d3a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".55"/>
      <stop offset=".45" stop-color="#fff" stop-opacity=".06"/>
      <stop offset="1" stop-color="#e2454f" stop-opacity=".75"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset=".6" stop-color="#b4232f" stop-opacity=".4"/>
      <stop offset="1" stop-color="#b4232f" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="50" cy="50" r="40" fill="url(#glow)"/>
  <circle cx="50" cy="50" r="30" fill="url(#body)"/>
  <circle cx="50" cy="50" r="30" fill="url(#ember)"/>
  <circle cx="50" cy="50" r="29.4" fill="none" stroke="url(#rim)" stroke-width="1.2"/>
  <g stroke="#ece4e5" stroke-width="4.2" stroke-linecap="round">
    <line x1="38" y1="45" x2="38" y2="55"/>
    <line x1="46" y1="38" x2="46" y2="62"/>
    <line x1="54" y1="42" x2="54" y2="58"/>
    <line x1="62" y1="46.5" x2="62" y2="53.5"/>
  </g>
  <ellipse cx="40" cy="30" rx="12" ry="5.5" fill="#fff" opacity=".28" transform="rotate(-24 40 30)"/>
</svg>`;

const page = (w, h, bg, inner) => `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;display:grid;place-items:center;background:${bg};overflow:hidden">${inner}</body></html>`;
const BG = 'radial-gradient(120% 100% at 30% 0%, #222227, #0a0a0c 70%)';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (file, w, h, html, transparent = false) => {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(html);
    await p.screenshot({ path: file, omitBackground: transparent });
  };
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = path.join(RES, `mipmap-${d}`);
    const s = Math.round(48 * k);
    await shot(path.join(dir, 'ic_launcher.png'), s, s, page(s, s, 'transparent', `<div style="width:${s}px;height:${s}px;border-radius:${s * 0.22}px;background:${BG};display:grid;place-items:center">${orb(s * 0.92)}</div>`), true);
    await shot(path.join(dir, 'ic_launcher_round.png'), s, s, page(s, s, 'transparent', `<div style="width:${s}px;height:${s}px;border-radius:50%;background:${BG};display:grid;place-items:center">${orb(s * 0.92)}</div>`), true);
    const f = Math.round(108 * k);
    await shot(path.join(dir, 'ic_launcher_foreground.png'), f, f, page(f, f, 'transparent', orb(f * 0.62)), true);
  }
  // splash screens: keep each existing size
  for (const dir of fs.readdirSync(RES).filter((n) => n.startsWith('drawable'))) {
    const file = path.join(RES, dir, 'splash.png');
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const o = Math.round(Math.min(w, h) * 0.28);
    await shot(file, w, h, page(w, h, BG, orb(o)));
  }
  await b.close();
  console.log('Android icons and splash screens written');
})();
