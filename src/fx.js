// Visual effects: aurora background, floating soap bubbles, cursor lighting,
// liquid-glass refraction filter and 3D tilt.
import { clamp, lerp } from './util.js';

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
  // body: clear center, colored iridescent rim
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
  // second hue on the lower rim for an oily, soap-film look
  const film = x.createLinearGradient(0, size, size, 0);
  film.addColorStop(0, 'rgba(255,140,220,0.22)');
  film.addColorStop(0.5, 'rgba(255,255,255,0)');
  film.addColorStop(1, 'rgba(120,220,255,0.18)');
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = film;
  x.fillRect(0, 0, size, size);
  x.globalCompositeOperation = 'source-over';
  // specular highlights
  x.fillStyle = 'rgba(255,255,255,0.75)';
  x.beginPath();
  x.ellipse(R * 0.62, R * 0.52, R * 0.26, R * 0.12, -0.7, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = 'rgba(255,255,255,0.9)';
  x.beginPath();
  x.arc(R * 1.42, R * 1.38, R * 0.05, 0, Math.PI * 2);
  x.fill();
  return cv;
}

export function initFX(settings) {
  const bg = document.getElementById('bg');
  bg.innerHTML = `
    <div class="bg-base"></div>
    <div class="rings"></div>
    <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="blob b4"></div>
    <canvas class="bubbles"></canvas>
    <div class="spot"></div>
    <div class="grain"></div>`;

  // Liquid-glass refraction: a noise displacement map applied to whatever is behind each panel.
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<svg class="svg-defs" width="0" height="0" aria-hidden="true">
      <filter id="liquid" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence id="refract-noise" type="fractalNoise" baseFrequency="0.007 0.011" numOctaves="2" seed="8" result="noise"/>
        <feGaussianBlur in="noise" stdDeviation="2.5" result="soft"/>
        <feDisplacementMap id="refract-map" in="SourceGraphic" in2="soft" scale="${settings.refraction}" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </svg>`,
  );

  const blobs = [...bg.querySelectorAll('.blob')];
  const spot = bg.querySelector('.spot');
  const canvas = bg.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const noise = document.getElementById('refract-noise');

  let cfg = settings;
  let W = 0, H = 0, dpr = 1;
  let sprites = [];
  let bubbles = [];
  let pulse = 0;
  const ptr = { x: innerWidth / 2, y: innerHeight / 2, sx: innerWidth / 2, sy: innerHeight / 2, moved: true, inside: false };

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

  function setColors(colors) {
    sprites = colors.map((c) => bubbleSprite(c));
  }

  addEventListener('resize', resize);
  resize();

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

  // Click empty background to pop bubbles
  addEventListener('pointerdown', (e) => {
    if (e.target.closest('.pane, .topbar, .tabbar, .drawer, .overlay, .sheet, .modal, button, input')) return;
    for (const b of bubbles) {
      if (!b.pop && Math.hypot(b.x - e.clientX, b.y - e.clientY) < b.r + 6) {
        b.pop = 1;
        for (let i = 0; i < 5; i++) {
          const s = makeBubble(b.x, b.y, 3 + Math.random() * 7, true);
          const a = Math.random() * Math.PI * 2;
          s.vx = Math.cos(a) * 3;
          s.vy = Math.sin(a) * 3;
          bubbles.push(s);
        }
      }
    }
  });

  // Tilt + local light for anything marked data-tilt (cards, album art)
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
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.setProperty('--lx', `${px * 100}%`);
      el.style.setProperty('--ly', `${py * 100}%`);
      if (document.documentElement.dataset.tilt !== 'on') return;
      const max = (Number(el.dataset.tilt) || 10) * cfg.motion;
      el.classList.add('tilting');
      el.style.setProperty('--rx', `${(0.5 - py) * max}deg`);
      el.style.setProperty('--ry', `${(px - 0.5) * max}deg`);
    },
    { passive: true },
  );

  let t0 = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - t0) / 16.67;
    t0 = now;
    const m = cfg.motion;
    const t = now / 1000;
    pulse *= 0.94;

    ptr.sx = lerp(ptr.sx, ptr.x, 0.12);
    ptr.sy = lerp(ptr.sy, ptr.y, 0.12);
    const nx = ptr.sx / W - 0.5, ny = ptr.sy / H - 0.5;

    // Aurora blobs drift, breathe and lean toward the cursor
    blobs.forEach((b, i) => {
      const k = i + 1;
      const x = Math.sin(t * 0.13 * k + k) * 14 * m + nx * 6 * k * m;
      const y = Math.cos(t * 0.11 * k + k * 2) * 12 * m + ny * 5 * k * m;
      const s = 1 + Math.sin(t * 0.4 + k) * 0.06 * m + pulse * 0.12;
      b.style.transform = `translate3d(${x}vw, ${y}vh, 0) scale(${s})`;
    });

    spot.style.transform = `translate3d(${ptr.sx}px, ${ptr.sy}px, 0)`;
    spot.style.opacity = ptr.inside && cfg.light ? cfg.lightStrength : 0;

    // Cursor light on glass panels
    if (ptr.moved) {
      ptr.moved = false;
      for (const el of document.querySelectorAll('.lit')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        el.style.setProperty('--lx', `${ptr.x - r.left}px`);
        el.style.setProperty('--ly', `${ptr.y - r.top}px`);
      }
    }

    // Slowly morph the refraction pattern so the glass feels liquid
    if (m > 0 && noise && Math.round(now / 120) % 2 === 0) {
      const f = 0.007 + Math.sin(t * 0.25) * 0.0012 * m;
      noise.setAttribute('baseFrequency', `${f.toFixed(5)} ${(f * 1.55).toFixed(5)}`);
    }

    // Bubbles
    ctx.clearRect(0, 0, W, H);
    if (sprites.length) {
      for (const b of bubbles) {
        b.phase += 0.01 * dt;
        b.vy -= b.rise * 0.02 * dt * (1 + pulse * 2);
        b.vx += Math.sin(b.phase) * 0.004 * dt;
        const dx = b.x - ptr.sx, dy = b.y - ptr.sy;
        const d = Math.hypot(dx, dy);
        const reach = b.r + 110;
        if (ptr.inside && d < reach && d > 0.1) {
          const f = ((reach - d) / reach) * 0.6;
          b.vx += (dx / d) * f * dt;
          b.vy += (dy / d) * f * dt;
        }
        b.vx *= 0.96;
        b.vy *= 0.96;
        const sp = m || 0.15;
        b.x += b.vx * dt * sp;
        b.y += (b.vy - b.rise) * dt * sp;
        if (b.life !== Infinity) b.life -= 0.006 * dt;
        if (b.pop) b.pop += 0.12 * dt;
        if (b.y < -b.r * 2 || b.x < -b.r * 3 || b.x > W + b.r * 3) {
          Object.assign(b, makeBubble(Math.random() * W, H + b.r * 2), { sprite: b.sprite });
        }
        const wob = 1 + Math.sin(b.phase * 3) * 0.035;
        const scale = b.pop ? 1 + b.pop * 0.6 : 1;
        const alpha = b.pop ? Math.max(0, 1 - b.pop) : Math.min(1, b.life);
        if (alpha <= 0) continue;
        const r = b.r * scale;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[b.sprite % sprites.length], b.x - r * wob, b.y - r / wob, r * 2 * wob, (r * 2) / wob);
      }
      ctx.globalAlpha = 1;
      bubbles = bubbles.filter((b) => (b.life === Infinity ? !(b.pop >= 1) || respawn(b) : b.life > 0 && !(b.pop >= 1)));
    }
    requestAnimationFrame(frame);
  }
  const respawn = (b) => {
    Object.assign(b, makeBubble(Math.random() * W, H + 80), { sprite: b.sprite });
    return true;
  };

  return {
    start() {
      syncCount();
      requestAnimationFrame(frame);
    },
    configure(s) {
      cfg = s;
      syncCount();
    },
    setColors,
    /** A beat of energy: aurora swells and bubbles float faster. */
    pulse(n = 1) {
      pulse = clamp(pulse + n, 0, 1.2);
    },
    /** A few tiny bubbles rise from a point on screen (e.g. a lyric line). */
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
