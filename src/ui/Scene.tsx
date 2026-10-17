import { useEffect, useRef } from 'react';
import type { MoodId } from '@shared/index';
import { useStore } from '../services/store';
import { getVisualizerSource } from './visualizerSource';

interface Palette {
  sky: [string, string, string];
  glow: string;
  city: string;
  window: string;
  orb: 'moon' | 'sun';
  stars: number;
}

const PALETTES: Record<MoodId, Palette> = {
  study: { sky: ['#12162e', '#2a2347', '#5a3a50'], glow: '255,179,92', city: '#0d0d18', window: '255,206,130', orb: 'moon', stars: 0.6 },
  rainy: { sky: ['#0e141c', '#1d2833', '#394552'], glow: '240,176,112', city: '#0a0e13', window: '230,190,140', orb: 'moon', stars: 0 },
  sunday: { sky: ['#2d4370', '#8a78a6', '#f0b088'], glow: '255,214,160', city: '#2a2433', window: '255,236,190', orb: 'sun', stars: 0 },
  drift: { sky: ['#040f17', '#0d2737', '#22475a'], glow: '143,211,201', city: '#03090e', window: '170,230,220', orb: 'moon', stars: 1 },
};

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
  lit: Array<{ x: number; y: number; phase: number; on: boolean }>;
}

function makeSkyline(seed: number): Building[] {
  const r = prng(seed);
  const out: Building[] = [];
  let x = -0.02;
  while (x < 1.02) {
    const w = 0.035 + r() * 0.07;
    const h = 0.12 + r() * 0.38;
    const lit: Building['lit'] = [];
    for (let wy = 0.02; wy < h - 0.03; wy += 0.035) {
      for (let wx = 0.008; wx < w - 0.01; wx += 0.016) {
        if (r() < 0.32) lit.push({ x: wx, y: wy, phase: r() * Math.PI * 2, on: r() < 0.85 });
      }
    }
    out.push({ x, w, h, lit });
    x += w + r() * 0.012;
  }
  return out;
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
  r: number;
  slide: number;
}

/**
 * Night window: sky + skyline seen through a rainy window, a lamp glow that breathes with the music, a mug that
 * steams. Rain density follows the "rain" ambience control; colours follow the station.
 */
export function Scene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const skyline = makeSkyline(7);
    const stars = Array.from({ length: 70 }, (_, i) => {
      const r = prng(100 + i);
      return { x: r(), y: r() * 0.5, s: 0.5 + r() * 1.2, p: r() * 6.28 };
    });
    const drops: Drop[] = [];
    const beads: Bead[] = Array.from({ length: 40 }, (_, i) => {
      const r = prng(500 + i);
      return { x: r(), y: r(), r: 0.6 + r() * 2.2, slide: 0 };
    });
    let raf = 0;
    let w = 0;
    let h = 0;
    let last = performance.now();
    let glow = 0;
    let visible = true;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
      const pal = PALETTES[st.params.mood];
      const rain = st.tape.rain;
      const level = getVisualizerSource()?.getLevel() ?? 0;
      glow += ((st.playing ? 0.55 + level * 0.9 : 0.35) - glow) * Math.min(1, dt * 4);

      // ---- sky
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, pal.sky[0]);
      g.addColorStop(0.6, pal.sky[1]);
      g.addColorStop(1, pal.sky[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      if (pal.stars > 0) {
        for (const s of stars) {
          const a = pal.stars * (0.35 + 0.35 * Math.sin(t * 0.8 + s.p)) * (1 - rain * 0.8);
          ctx.fillStyle = `rgba(255,248,230,${a.toFixed(3)})`;
          ctx.fillRect(s.x * w, s.y * h, s.s, s.s);
        }
      }

      // ---- moon / sun (veiled by rain)
      const ox = w * 0.74;
      const oy = h * (pal.orb === 'sun' ? 0.52 : 0.26);
      const orbR = Math.min(w, h) * (pal.orb === 'sun' ? 0.13 : 0.075);
      const halo = ctx.createRadialGradient(ox, oy, orbR * 0.4, ox, oy, orbR * 4);
      const orbCol = pal.orb === 'sun' ? '255,214,170' : '240,236,220';
      halo.addColorStop(0, `rgba(${orbCol},${0.35 - rain * 0.2})`);
      halo.addColorStop(1, `rgba(${orbCol},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `rgba(${orbCol},${0.92 - rain * 0.45})`;
      ctx.beginPath();
      ctx.arc(ox, oy, orbR, 0, Math.PI * 2);
      ctx.fill();

      // ---- skyline
      const base = h * 0.86;
      for (const b of skyline) {
        const bx = b.x * w;
        const bw = b.w * w;
        const bh = b.h * h;
        ctx.fillStyle = pal.city;
        ctx.fillRect(bx, base - bh, bw, bh + h);
        for (const l of b.lit) {
          if (!l.on) continue;
          const flicker = 0.55 + 0.45 * Math.sin(t * 0.15 + l.phase);
          ctx.fillStyle = `rgba(${pal.window},${(0.25 + 0.5 * flicker).toFixed(3)})`;
          ctx.fillRect(bx + l.x * w, base - bh + l.y * h, Math.max(1.5, w * 0.006), Math.max(1.5, h * 0.012));
        }
      }

      // ---- rain outside (streaks)
      const target = Math.round(rain * 260);
      while (drops.length < target) drops.push({ x: Math.random() * w * 1.2, y: Math.random() * -h, len: 8 + Math.random() * 16, speed: 420 + Math.random() * 380 });
      if (drops.length > target) drops.length = target;
      ctx.strokeStyle = 'rgba(190,210,235,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of drops) {
        if (!reduceMotion) {
          d.y += d.speed * dt;
          d.x -= d.speed * dt * 0.12;
        }
        if (d.y > h) {
          d.y = -d.len - Math.random() * 40;
          d.x = Math.random() * w * 1.2;
        }
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.12, d.y + d.len);
      }
      ctx.stroke();

      // ---- beads on the glass (slide down now and then)
      const beadCount = Math.round(rain * beads.length);
      for (let i = 0; i < beadCount; i++) {
        const b = beads[i]!;
        if (!reduceMotion) {
          if (b.slide > 0) {
            b.y += dt * 0.25 * b.slide;
            b.slide = Math.max(0, b.slide - dt * 0.6);
          } else if (Math.random() < dt * 0.05) b.slide = 1;
          if (b.y > 1.02) {
            b.y = -0.02;
            b.x = Math.random();
          }
        }
        ctx.fillStyle = 'rgba(220,235,255,0.22)';
        ctx.beginPath();
        ctx.arc(b.x * w, b.y * h, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(b.x * w - b.r * 0.35, b.y * h - b.r * 0.4, 1, 1);
      }

      // ---- room: lamp glow from the lower left
      const lamp = ctx.createRadialGradient(w * 0.08, h * 1.02, 4, w * 0.08, h * 1.02, Math.max(w, h) * 0.75);
      lamp.addColorStop(0, `rgba(${pal.glow},${(0.42 * glow).toFixed(3)})`);
      lamp.addColorStop(0.5, `rgba(${pal.glow},${(0.12 * glow).toFixed(3)})`);
      lamp.addColorStop(1, `rgba(${pal.glow},0)`);
      ctx.fillStyle = lamp;
      ctx.fillRect(0, 0, w, h);

      // ---- window frame
      const frame = '#1d1610';
      ctx.fillStyle = frame;
      const fw = Math.max(6, w * 0.012);
      ctx.fillRect(0, 0, w, fw);
      ctx.fillRect(0, 0, fw, h);
      ctx.fillRect(w - fw, 0, fw, h);
      ctx.fillRect(w / 2 - fw / 2, 0, fw, h);
      ctx.fillRect(0, h * 0.42, w, fw * 0.7);
      const sill = h * 0.9;
      ctx.fillStyle = '#2a2018';
      ctx.fillRect(0, sill, w, h - sill);
      ctx.fillStyle = 'rgba(255,200,140,0.08)';
      ctx.fillRect(0, sill, w, 2);

      // ---- mug + steam
      const mx = w * 0.2;
      const mw = Math.max(18, w * 0.028);
      const mh = mw * 1.05;
      ctx.fillStyle = '#c9b79a';
      ctx.fillRect(mx, sill - mh, mw, mh);
      ctx.strokeStyle = '#c9b79a';
      ctx.lineWidth = Math.max(2, mw * 0.14);
      ctx.beginPath();
      ctx.arc(mx + mw, sill - mh * 0.55, mw * 0.28, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      if (!reduceMotion) {
        ctx.lineWidth = 1.4;
        for (let i = 0; i < 3; i++) {
          const phase = (t * 0.35 + i / 3) % 1;
          ctx.strokeStyle = `rgba(240,230,215,${(0.28 * (1 - phase)).toFixed(3)})`;
          ctx.beginPath();
          const sx = mx + mw * (0.3 + i * 0.2);
          for (let k = 0; k <= 10; k++) {
            const yy = sill - mh - phase * mh * 1.6 - (k / 10) * mh * 0.9;
            const xx = sx + Math.sin(k * 0.7 + t * 1.5 + i) * mw * 0.12;
            if (k === 0) ctx.moveTo(xx, yy);
            else ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        }
      }

      // ---- plant silhouette
      const px = w * 0.86;
      ctx.fillStyle = '#6b4a33';
      ctx.fillRect(px, sill - mw * 0.9, mw * 1.2, mw * 0.9);
      ctx.strokeStyle = '#2f4a32';
      ctx.lineWidth = Math.max(2, mw * 0.12);
      for (let i = 0; i < 6; i++) {
        const sway = reduceMotion ? 0 : Math.sin(t * 0.6 + i) * 2;
        ctx.beginPath();
        ctx.moveTo(px + mw * 0.6, sill - mw * 0.9);
        ctx.quadraticCurveTo(px + mw * (0.6 + (i - 2.5) * 0.4), sill - mw * 2, px + mw * (0.6 + (i - 2.5) * 0.7) + sway, sill - mw * (1.6 + (i % 3) * 0.5));
        ctx.stroke();
      }

      // ---- film grain / vignette
      const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
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
