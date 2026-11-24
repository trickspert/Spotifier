// Visual effects, built to stay smooth on phones:
//  - the cover backdrop and the "melting" drips are painted ONCE per song into small canvases
//    and simply stretched by the GPU (stretching a tiny image = free, natural blur)
//  - nothing runs per frame unless it's actually visible (soap bubbles, aurora, cursor light)
import { clamp, lerp } from './util.js';

const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function bubbleSprite(hex, size = 128) {
  const [r, g, b] = hexToRgb(hex);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const x = cv.getContext('2d');
  const R = size / 2;
  const body = x.createRadialGradient(R, R, R * 0.1, R, R, R);
  body.addColorStop(0, `rgba(${r},${g},${b},0.02)`);
  body.addColorStop(0.62, `rgba(${r},${g},${b},0.07)`);
  body.addColorStop(0.86, `rgba(${r},${g},${b},0.32)`);
  body.addColorStop(0.96, 'rgba(255,255,255,0.55)');
  body.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = body;
  x.beginPath();
  x.arc(R, R, R, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = 'rgba(255,255,255,0.75)';
  x.beginPath();
  x.ellipse(R * 0.62, R * 0.52, R * 0.26, R * 0.12, -0.7, 0, Math.PI * 2);
  x.fill();
  return cv;
}

// ---------- images, loaded once and shared ----------
const imgCache = new Map();
export function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (!imgCache.has(url)) {
    imgCache.set(
      url,
      new Promise((res) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = url;
      }),
    );
  }
  return imgCache.get(url);
}

/** Paints a soft, saturated wash of the cover (used full screen behind everything). */
function paintBackdrop(cv, img) {
  const S = 96;
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  if (!img) return;
  g.filter = 'blur(7px) saturate(1.7)';
  // three overlapping, rotated copies give the "flowing" Apple Music look
  const draws = [
    [0, 0, 1.25, 0],
    [S * 0.55, S * 0.5, 1.0, 2.1],
    [S * 0.15, S * 0.65, 0.8, 4.2],
  ];
  for (const [x, y, sc, rot] of draws) {
    g.save();
    g.translate(x + (S * sc) / 2, y + (S * sc) / 2);
    g.rotate(rot);
    g.drawImage(img, (-S * sc) / 2, (-S * sc) / 2, S * sc, S * sc);
    g.restore();
  }
  g.filter = 'none';
}

/** Paints the cover's bottom edge dripping downward, like it's melting. Drawn once per song. */
export async function paintMelt(cv, url) {
  const img = await loadImage(url);
  const W = 60, H = 90;
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  if (!img) return;
  g.filter = 'saturate(1.5)';
  g.drawImage(img, 0, 0, W, W);
  // stretch each thin column of the bottom edge down by a different amount
  let seed = url.length;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const iw = img.naturalWidth, ih = img.naturalHeight;
  for (let x = 0; x < W; x += 2) {
    const len = 10 + rnd() * 28 + Math.sin(x * 0.35) * 6;
    g.drawImage(img, (x / W) * iw, ih * 0.9, (2 / W) * iw, ih * 0.1, x, W - 6, 2, len);
  }
  g.filter = 'blur(2px)';
  g.globalCompositeOperation = 'copy';
  g.drawImage(cv, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.filter = 'none';
}

export function initFX(settings) {
  const bg = document.getElementById('bg');
  bg.innerHTML = `
    <div class="bg-base"></div>
    <div class="art-bg"><canvas class="art-layer"></canvas><canvas class="art-layer"></canvas></div>
    <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
    <canvas class="bubbles"></canvas>
    <div class="spot"></div>`;
  document.body.insertAdjacentHTML('afterbegin', '<svg class="svg-defs" width="0" height="0" aria-hidden="true"></svg>');

  const blobs = [...bg.querySelectorAll('.blob')];
  const artBg = bg.querySelector('.art-bg');
  const artLayers = [...bg.querySelectorAll('.art-layer')];
  let artFront = 0;
  let artUrl = null;
  const spot = bg.querySelector('.spot');
  const canvas = bg.querySelector('.bubbles');
  const ctx = canvas.getContext('2d');

  let cfg = settings;
  let W = 0, H = 0, dpr = 1;
  let sprites = [];
  let bubbles = [];
  let canvasDirty = false;
  let pulse = 0;
  const ptr = { x: innerWidth / 2, y: innerHeight / 2, sx: innerWidth / 2, sy: innerHeight / 2, moved: false, inside: false };

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = innerWidth;
    H = innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const makeBubble = (x, y, r, small = false) => ({
    x: x ?? Math.random() * W,
    y: y ?? H + Math.random() * H,
    r: r ?? 10 + Math.random() ** 2 * 60,
    vx: 0,
    vy: 0,
    rise: 0.15 + Math.random() * 0.35,
    phase: Math.random() * Math.PI * 2,
    sprite: Math.floor(Math.random() * 3),
    life: small ? 1 : Infinity,
    pop: 0,
  });

  function syncCount() {
    const want = cfg.bubbles ? cfg.bubbleCount : 0;
    const perm = bubbles.filter((b) => b.life === Infinity);
    while (perm.length < want) {
      const b = makeBubble(undefined, Math.random() * H);
      perm.push(b);
      bubbles.push(b);
    }
    if (perm.length > want) {
      const drop = new Set(perm.slice(want));
      bubbles = bubbles.filter((b) => !drop.has(b));
    }
  }

  addEventListener('resize', resize);
  resize();

  // Cursor light and tilt are for mice only; on touch screens they'd just cost battery
  if (finePointer) {
    addEventListener(
      'pointermove',
      (e) => {
        ptr.x = e.clientX;
        ptr.y = e.clientY;
        ptr.moved = true;
        ptr.inside = true;
      },
      { passive: true },
    );
    document.addEventListener('pointerleave', () => (ptr.inside = false));

    let tiltEl = null;
    const resetTilt = (el) => {
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
      el.classList.remove('tilting');
    };
    document.addEventListener(
      'pointermove',
      (e) => {
        const el = e.target.closest?.('[data-tilt]');
        if (tiltEl && tiltEl !== el) resetTilt(tiltEl);
        tiltEl = el;
        if (!el || document.documentElement.dataset.tilt !== 'on') return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        const max = (Number(el.dataset.tilt) || 10) * cfg.motion;
        el.classList.add('tilting');
        el.style.setProperty('--rx', `${(0.5 - py) * max}deg`);
        el.style.setProperty('--ry', `${(px - 0.5) * max}deg`);
      },
      { passive: true },
    );
  }

  // Tap empty background to pop soap bubbles
  addEventListener('pointerdown', (e) => {
    if (!bubbles.length || e.target.closest('button, a, input, .lg, [role="button"]')) return;
    for (const b of bubbles) {
      if (!b.pop && Math.hypot(b.x - e.clientX, b.y - e.clientY) < b.r + 6) b.pop = 1;
    }
  });

  let t0 = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - t0) / 16.67;
    t0 = now;
    const m = cfg.motion;
    const t = now / 1000;

    if (pulse > 0.002) {
      pulse *= 0.93;
      artBg.style.scale = String(1 + pulse * 0.035);
    }

    if (cfg.backdrop === 'aurora') {
      blobs.forEach((b, i) => {
        const k = i + 1;
        const x = Math.sin(t * 0.13 * k + k) * 14 * m;
        const y = Math.cos(t * 0.11 * k + k * 2) * 12 * m;
        b.style.transform = `translate3d(${x}vw, ${y}vh, 0) scale(${1 + pulse * 0.12})`;
      });
    }

    if (finePointer) {
      ptr.sx = lerp(ptr.sx, ptr.x, 0.14);
      ptr.sy = lerp(ptr.sy, ptr.y, 0.14);
      spot.style.transform = `translate3d(${ptr.sx}px, ${ptr.sy}px, 0)`;
      spot.style.opacity = ptr.inside && cfg.light ? cfg.lightStrength : 0;
      if (ptr.moved && cfg.light) {
        ptr.moved = false;
        for (const el of document.querySelectorAll('.lg')) {
          const r = el.getBoundingClientRect();
          if (!r.width || r.bottom < 0 || r.top > H) continue;
          el.style.setProperty('--lx', `${ptr.x - r.left}px`);
          el.style.setProperty('--ly', `${ptr.y - r.top}px`);
        }
      }
    }

    // Soap bubbles: only touch the canvas when there's something to draw
    if (bubbles.length && sprites.length) {
      canvasDirty = true;
      ctx.clearRect(0, 0, W, H);
      for (const b of bubbles) {
        b.phase += 0.01 * dt;
        b.vy -= b.rise * 0.02 * dt;
        b.vx += Math.sin(b.phase) * 0.004 * dt;
        if (finePointer && ptr.inside) {
          const dx = b.x - ptr.sx, dy = b.y - ptr.sy;
          const d = Math.hypot(dx, dy);
          const reach = b.r + 110;
          if (d < reach && d > 0.1) {
            const f = ((reach - d) / reach) * 0.6;
            b.vx += (dx / d) * f * dt;
            b.vy += (dy / d) * f * dt;
          }
        }
        b.vx *= 0.96;
        b.vy *= 0.96;
        const sp = m || 0.15;
        b.x += b.vx * dt * sp;
        b.y += (b.vy - b.rise) * dt * sp;
        if (b.life !== Infinity) b.life -= 0.006 * dt;
        if (b.pop) b.pop += 0.12 * dt;
        if (b.y < -b.r * 2 || b.x < -b.r * 3 || b.x > W + b.r * 3) Object.assign(b, makeBubble(Math.random() * W, H + b.r * 2), { sprite: b.sprite });
        const alpha = b.pop ? Math.max(0, 1 - b.pop) : Math.min(1, b.life);
        if (alpha <= 0) continue;
        const r = b.r * (b.pop ? 1 + b.pop * 0.6 : 1);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[b.sprite % sprites.length], b.x - r, b.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      bubbles = bubbles.filter((b) => {
        if (b.life === Infinity) {
          if (b.pop >= 1) Object.assign(b, makeBubble(Math.random() * W, H + 80), { sprite: b.sprite });
          return true;
        }
        return b.life > 0 && !(b.pop >= 1);
      });
    } else if (canvasDirty) {
      ctx.clearRect(0, 0, W, H);
      canvasDirty = false;
    }
    requestAnimationFrame(frame);
  }

  return {
    start() {
      syncCount();
      requestAnimationFrame(frame);
    },
    configure(s) {
      cfg = s;
      syncCount();
    },
    setColors(colors) {
      sprites = colors.map((c) => bubbleSprite(c));
    },
    /** Crossfades the full-screen backdrop to a new cover. Only repaints when the cover changes. */
    async setArt(url) {
      if (url === artUrl) return;
      artUrl = url;
      const img = await loadImage(url);
      if (url !== artUrl) return;
      const next = artLayers[1 - artFront];
      paintBackdrop(next, img);
      next.classList.toggle('on', !!img);
      artLayers[artFront].classList.remove('on');
      artFront = 1 - artFront;
    },
    pulse(n = 1) {
      if (cfg.motion) pulse = clamp(pulse + n, 0, 1);
    },
    burst(x, y, n = 4) {
      if (!cfg.bubbles || !cfg.motion) return;
      for (let i = 0; i < n; i++) {
        const b = makeBubble(x + (Math.random() - 0.5) * 120, y, 4 + Math.random() * 12, true);
        b.vy = -1 - Math.random() * 2;
        bubbles.push(b);
      }
    },
  };
}
