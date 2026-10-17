import { useEffect, useRef } from 'react';
import { ChaosLfo, speedFor } from '../services/chaos';
import { useStore } from '../services/store';

const TRAIL = 420;

/**
 * Draws a Lorenz attractor trail (x vs z) running at the chaos LFO's rate: a picture of what is riding the knobs.
 * It is its own attractor instance (purely visual), brightness follows the amount.
 */
export function ChaosScope() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const lfo = new ChaosLfo(7);
    const trail: Array<[number, number]> = [];
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const st = useStore.getState();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const running = st.playing && !reduceMotion;
      if (running) {
        // the picture runs a little faster than the modulation so the shape is readable
        const steps = 3;
        for (let i = 0; i < steps; i++) {
          lfo.step((dt * 6) / steps, { ...st.chaos, amount: 0 }, '');
          const [x, , z] = lfo.state();
          trail.push([x, z]);
        }
        while (trail.length > TRAIL) trail.shift();
      }
      const r = canvas.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      ctx.clearRect(0, 0, w, h);
      const amount = st.chaos.amount;
      const alpha = 0.15 + amount * 0.85;
      ctx.lineWidth = 1.2;
      for (let i = 1; i < trail.length; i++) {
        const [x0, z0] = trail[i - 1]!;
        const [x1, z1] = trail[i]!;
        const age = i / trail.length;
        ctx.strokeStyle = `rgba(240,184,64,${(alpha * age).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(w / 2 + x0 * w * 0.42, h / 2 - z0 * h * 0.4);
        ctx.lineTo(w / 2 + x1 * w * 0.42, h / 2 - z1 * h * 0.4);
        ctx.stroke();
      }
      const head = trail[trail.length - 1];
      if (head) {
        ctx.fillStyle = `rgba(255,107,53,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(w / 2 + head[0] * w * 0.42, h / 2 - head[1] * h * 0.4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(138,128,114,0.9)';
      ctx.font = '9px "Space Mono", monospace';
      ctx.fillText(`${(speedFor(st.chaos.rate) * 10).toFixed(2)}x`, 6, h - 6);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="chaos__scope" aria-hidden="true" />;
}
