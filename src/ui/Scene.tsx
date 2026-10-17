import { useEffect, useRef } from 'react';
import type { MoodId } from '@shared/index';
import { useStore } from '../services/store';
import { getVisualizerSource } from './visualizerSource';
import { isCatNapping } from '../services/wildcat';

/** Size of one art pixel on screen (CSS px). */
const PIXEL = 4;

interface Palette {
  sky: [string, string, string];
  glow: [number, number, number];
  city: string;
  cityEdge: string;
  window: [number, number, number];
  orb: 'moon' | 'sun';
  orbColor: string;
  stars: number;
}

const PALETTES: Record<MoodId, Palette> = {
  study: { sky: ['#141634', '#2b2450', '#5e3a58'], glow: [255, 176, 92], city: '#0e0d1c', cityEdge: '#1c1a33', window: [255, 206, 130], orb: 'moon', orbColor: '#f2ecd8', stars: 0.7 },
  rainy: { sky: ['#0f1620', '#1f2b38', '#3b4856'], glow: [240, 176, 112], city: '#0a0e14', cityEdge: '#18212b', window: [230, 190, 140], orb: 'moon', orbColor: '#d9dde0', stars: 0 },
  sunday: { sky: ['#2f4775', '#8c79a8', '#f2b08a'], glow: [255, 214, 160], city: '#2b2436', cityEdge: '#40364f', window: [255, 236, 190], orb: 'sun', orbColor: '#ffe0a8', stars: 0 },
  drift: { sky: ['#04101a', '#0d2838', '#23495c'], glow: [143, 211, 201], city: '#03090f', cityEdge: '#0d1d26', window: [170, 230, 220], orb: 'moon', orbColor: '#e6f2ee', stars: 1 },
};

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Tiny deterministic PRNG so the skyline is the same every frame. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Building {
  x: number;
  w: number;
  h: number;
  lit: Array<{ x: number; y: number; phase: number }>;
}

/** Skyline in art pixels. */
function makeSkyline(W: number, H: number, base: number): Building[] {
  const r = prng(7);
  const out: Building[] = [];
  let x = -2;
  while (x < W + 2) {
    const w = 8 + Math.floor(r() * 16);
    const h = Math.floor(H * (0.14 + r() * 0.42));
    const lit: Building['lit'] = [];
    for (let wy = 3; wy < h - 3; wy += 3) {
      for (let wx = 2; wx < w - 2; wx += 3) if (r() < 0.3) lit.push({ x: wx, y: wy, phase: r() * Math.PI * 2 });
    }
    out.push({ x, w, h: Math.min(h, base - 4), lit });
    x += w + Math.floor(r() * 3);
  }
  return out;
}

const SKY_SHADES = 12;

/** Colour at 0..1 along the 3-stop sky gradient. */
function skyColor(cs: Array<[number, number, number]>, t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * 2;
  const seg = Math.min(1, Math.floor(x));
  const f = x - seg;
  const a = cs[seg]!;
  const b = cs[seg + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/**
 * Pixel-art sky: the gradient is quantised to a few shades and ordered-dithered only between neighbouring shades,
 * so it reads as soft bands with a fine texture instead of a loud checkerboard.
 */
function ditherSky(W: number, H: number, colors: [string, string, string], horizon: number): ImageData {
  const img = new ImageData(W, H);
  const cs = colors.map(hexToRgb);
  const shades = Array.from({ length: SKY_SHADES }, (_, i) => skyColor(cs, i / (SKY_SHADES - 1)).map(Math.round));
  for (let y = 0; y < H; y++) {
    const p = Math.min(1, y / horizon) * (SKY_SHADES - 1);
    const lo = Math.min(SKY_SHADES - 2, Math.floor(p));
    const f = p - lo;
    for (let x = 0; x < W; x++) {
      const threshold = (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
      const c = shades[f > threshold ? lo + 1 : lo]!;
      const i = (y * W + x) * 4;
      img.data[i] = c[0]!;
      img.data[i + 1] = c[1]!;
      img.data[i + 2] = c[2]!;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

function disc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
    g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

/**
 * The cat asleep on the windowsill, in pixels: a ginger loaf with its tail wrapped round, slow breathing and a
 * pixel "z" drifting up. `cx` is the middle of the cat, `sill` the top row of the sill.
 */
function drawSleepingCat(g: CanvasRenderingContext2D, cx: number, sill: number, t: number, motion: boolean): void {
  const BODY = '#c98a4b';
  const DARK = '#9a5f2c';
  const LIGHT = '#e8c9a0';
  const px = (x: number, y: number, w = 1, h = 1): void => g.fillRect(cx + x, sill + y, w, h);
  const breathe = motion && Math.sin(t * 2.2) > 0;
  // tail curled round the front
  g.fillStyle = DARK;
  px(-7, -3);
  px(-7, -2);
  px(-6, -1, 3, 1);
  // body loaf (rounded corners), rising a pixel when it breathes in
  g.fillStyle = BODY;
  px(-5, -4, 9, 3);
  px(-4, -5, 7, 1);
  if (breathe) px(-3, -6, 4, 1);
  px(-4, -1, 8, 1);
  // stripes
  g.fillStyle = DARK;
  px(-3, -5, 1, 2);
  px(-1, -5, 1, 2);
  px(1, -5, 1, 2);
  // belly
  g.fillStyle = LIGHT;
  px(-2, -2, 4, 1);
  // head tucked on the right, ears up, eye shut
  g.fillStyle = BODY;
  px(3, -6, 4, 4);
  px(3, -7);
  px(6, -7);
  g.fillStyle = DARK;
  px(4, -4, 2, 1);
  g.fillStyle = '#e07a6a';
  px(7, -3);
  // a pixel z drifting up from its head
  if (motion) {
    const k = (t * 0.45) % 1;
    const zx = 7 + Math.round(k * 6);
    const zy = -10 - Math.round(k * 9);
    g.fillStyle = `rgba(232,223,200,${(0.9 * (1 - k)).toFixed(2)})`;
    px(zx, zy, 3, 1);
    px(zx + 1, zy + 1);
    px(zx, zy + 2, 3, 1);
  }
}

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
}

interface Bead {
  x: number;
  y: number;
  slide: number;
}

/**
 * Pixel-art night window: dithered sky, pixel moon (or sun) and stars, a blocky skyline whose windows flicker,
 * pixel rain and beads on the glass, a lamp glow that breathes with the music and a steaming mug on the sill.
 * Drawn at low resolution and scaled up with smoothing off. Rain follows the "rain" knob; colours follow the station.
 */
export function Scene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const lo = document.createElement('canvas');
    const g = lo.getContext('2d');
    if (!g) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let W = 1;
    let H = 1;
    let base = 1;
    let skyline: Building[] = [];
    let skyCache: { key: string; img: ImageData } | null = null;
    const stars = Array.from({ length: 60 }, (_, i) => {
      const r = prng(100 + i);
      return { x: r(), y: r() * 0.5, p: r() * 6.28 };
    });
    const drops: Drop[] = [];
    const beads: Bead[] = Array.from({ length: 36 }, (_, i) => {
      const r = prng(500 + i);
      return { x: r(), y: r(), slide: 0 };
    });
    let raf = 0;
    let last = performance.now();
    let glow = 0;
    let visible = true;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      W = Math.max(40, Math.round(rect.width / PIXEL));
      H = Math.max(24, Math.round(rect.height / PIXEL));
      lo.width = W;
      lo.height = H;
      base = Math.round(H * 0.86);
      skyline = makeSkyline(W, H, base);
      skyCache = null;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
    });
    io.observe(canvas);

    const draw = (nowMs: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const t = nowMs / 1000;
      const st = useStore.getState();
      const mood = st.params.mood;
      const pal = PALETTES[mood];
      const rain = st.tape.rain;
      const level = getVisualizerSource()?.getLevel() ?? 0;
      glow += ((st.playing ? 0.55 + level * 0.9 : 0.35) - glow) * Math.min(1, dt * 4);
      const sill = Math.round(H * 0.9);

      // ---- sky (cached dither)
      const key = `${mood}:${W}x${H}`;
      if (!skyCache || skyCache.key !== key) skyCache = { key, img: ditherSky(W, H, pal.sky, base) };
      g.putImageData(skyCache.img, 0, 0);

      // ---- stars (fade out in heavy rain)
      if (pal.stars > 0) {
        for (const s of stars) {
          const on = Math.sin(t * 0.9 + s.p) > 0.2 - pal.stars * 0.3 && rain < 0.85;
          if (!on) continue;
          g.fillStyle = Math.sin(t * 2 + s.p) > 0.6 ? '#fff8e6' : '#b9b3a6';
          g.fillRect(Math.floor(s.x * W), Math.floor(s.y * H), 1, 1);
        }
      }

      // ---- moon / sun with a dithered halo
      const ox = Math.round(W * 0.74);
      const oy = Math.round(H * (pal.orb === 'sun' ? 0.3 : 0.24));
      const r = Math.max(3, Math.round(Math.min(W, H) * (pal.orb === 'sun' ? 0.11 : 0.08)));
      const haloA = Math.max(0, 0.35 - rain * 0.2);
      g.fillStyle = pal.orbColor;
      for (let ring = r + 4; ring > r; ring--) {
        g.globalAlpha = haloA * (1 - (ring - r) / 5);
        disc(g, ox, oy, ring);
      }
      g.globalAlpha = 1 - rain * 0.4;
      disc(g, ox, oy, r);
      if (pal.orb === 'moon') {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(ox - Math.round(r / 3), oy - Math.round(r / 4), 2, 2);
        g.fillRect(ox + Math.round(r / 4), oy + Math.round(r / 3), 2, 1);
        g.fillRect(ox + 1, oy - Math.round(r / 2), 1, 1);
      }
      g.globalAlpha = 1;

      // ---- skyline with flickering windows
      for (const b of skyline) {
        g.fillStyle = pal.city;
        g.fillRect(b.x, base - b.h, b.w, H - (base - b.h));
        g.fillStyle = pal.cityEdge;
        g.fillRect(b.x, base - b.h, b.w, 1);
        for (const l of b.lit) {
          const flicker = 0.5 + 0.5 * Math.sin(t * 0.12 + l.phase);
          if (flicker < 0.15) continue;
          const [wr, wg, wb] = pal.window;
          g.fillStyle = `rgba(${wr},${wg},${wb},${(0.35 + 0.6 * flicker).toFixed(2)})`;
          g.fillRect(b.x + l.x, base - b.h + l.y, 1, 1);
        }
      }

      // ---- rain outside: short pixel streaks
      const target = Math.round(rain * W * 0.9);
      while (drops.length < target) drops.push({ x: Math.random() * W * 1.2, y: Math.random() * -H, len: 2 + Math.floor(Math.random() * 3), speed: 60 + Math.random() * 50 });
      if (drops.length > target) drops.length = target;
      g.fillStyle = 'rgba(190,210,235,0.45)';
      for (const d of drops) {
        if (!reduceMotion) {
          d.y += d.speed * dt;
          d.x -= d.speed * dt * 0.15;
        }
        if (d.y > H) {
          d.y = -d.len - Math.random() * 10;
          d.x = Math.random() * W * 1.2;
        }
        g.fillRect(Math.floor(d.x), Math.floor(d.y), 1, d.len);
      }

      // ---- beads on the glass (slide down now and then)
      const beadCount = Math.round(rain * beads.length);
      for (let i = 0; i < beadCount; i++) {
        const b = beads[i]!;
        if (!reduceMotion) {
          if (b.slide > 0) {
            b.y += dt * 0.12 * b.slide;
            b.slide = Math.max(0, b.slide - dt * 0.6);
          } else if (Math.random() < dt * 0.05) b.slide = 1;
          if (b.y > 1.02) {
            b.y = -0.02;
            b.x = Math.random();
          }
        }
        const bx = Math.floor(b.x * W);
        const by = Math.floor(b.y * sill);
        g.fillStyle = 'rgba(210,228,250,0.35)';
        g.fillRect(bx, by, 2, 2);
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.fillRect(bx, by, 1, 1);
      }

      // ---- lamp glow from the lower left (blocky once scaled up)
      const [lr, lg, lb] = pal.glow;
      const lamp = g.createRadialGradient(W * 0.08, H * 1.02, 1, W * 0.08, H * 1.02, Math.max(W, H) * 0.75);
      lamp.addColorStop(0, `rgba(${lr},${lg},${lb},${(0.42 * glow).toFixed(3)})`);
      lamp.addColorStop(0.5, `rgba(${lr},${lg},${lb},${(0.12 * glow).toFixed(3)})`);
      lamp.addColorStop(1, `rgba(${lr},${lg},${lb},0)`);
      g.fillStyle = lamp;
      g.fillRect(0, 0, W, H);

      // ---- window frame (chunky wood with a highlight edge)
      const fw = 3;
      g.fillStyle = '#21180f';
      g.fillRect(0, 0, W, fw);
      g.fillRect(0, 0, fw, H);
      g.fillRect(W - fw, 0, fw, H);
      g.fillRect(Math.round(W / 2) - 1, 0, fw, H);
      g.fillRect(0, Math.round(H * 0.42), W, 2);
      g.fillStyle = '#3a2a1b';
      g.fillRect(fw, fw, W - fw * 2, 1);
      g.fillRect(Math.round(W / 2) - 1, 0, 1, H);
      // sill
      g.fillStyle = '#2c2117';
      g.fillRect(0, sill, W, H - sill);
      g.fillStyle = '#4a3624';
      g.fillRect(0, sill, W, 1);

      // ---- mug + pixel steam
      const mx = Math.round(W * 0.2);
      g.fillStyle = '#d6c4a4';
      g.fillRect(mx, sill - 6, 5, 6);
      g.fillStyle = '#b8a582';
      g.fillRect(mx, sill - 6, 5, 1);
      g.fillStyle = '#d6c4a4';
      g.fillRect(mx + 5, sill - 5, 2, 1);
      g.fillRect(mx + 6, sill - 4, 1, 2);
      g.fillRect(mx + 5, sill - 2, 2, 1);
      if (!reduceMotion) {
        for (let i = 0; i < 3; i++) {
          const phase = (t * 0.35 + i / 3) % 1;
          g.fillStyle = `rgba(240,230,215,${(0.6 * (1 - phase)).toFixed(2)})`;
          const sy = sill - 8 - Math.floor(phase * 10);
          const sx = mx + 1 + i + Math.round(Math.sin(phase * 6 + i) * 1.2);
          g.fillRect(sx, sy, 1, 2);
        }
      }

      // ---- plant: pot + pixel leaves swaying
      const px = Math.round(W * 0.86);
      g.fillStyle = '#7a4f33';
      g.fillRect(px, sill - 5, 6, 5);
      g.fillStyle = '#5e3c26';
      g.fillRect(px - 1, sill - 6, 8, 1);
      g.fillStyle = '#3f6a42';
      for (let i = 0; i < 6; i++) {
        const sway = reduceMotion ? 0 : Math.round(Math.sin(t * 0.6 + i) * 0.8);
        const dir = i - 2.5;
        const len = 5 + (i % 3) * 2;
        for (let k = 1; k <= len; k++) {
          const lx = px + 3 + Math.round(dir * k * 0.35) + (k > len / 2 ? sway : 0);
          g.fillRect(lx, sill - 6 - k, 1, 1);
        }
      }
      g.fillStyle = '#5c8f5d';
      g.fillRect(px + 2, sill - 9, 1, 1);
      g.fillRect(px + 4, sill - 11, 1, 1);

      // ---- the cat, napping on the sill
      if (isCatNapping()) drawSleepingCat(g, Math.round(W * 0.66), sill, t, !reduceMotion);

      // ---- vignette
      const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.45)');
      g.fillStyle = vig;
      g.fillRect(0, 0, W, H);

      // ---- scale up, crisp
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(lo, 0, 0, canvas.width, canvas.height);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="scene" aria-hidden="true" />;
}
