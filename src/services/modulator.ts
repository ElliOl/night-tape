/**
 * Runs the chaos LFO while music plays and publishes its offsets to the store (`mod`). The Conductor turns those into
 * effective tape/filter settings (sent to the renderer) and effective groove settings (read by the composer).
 */
import { ChaosLfo, MOD_TARGETS, speedFor } from './chaos';
import type { ModOffsets } from './effective';
import { useStore } from './store';

const TICK_MS = 50;

export interface LfoSnapshot {
  /** normalised attractor state (roughly -1..1 each) */
  state: [number, number, number];
  /** rate of change per Lorenz time unit, squashed to -1..1 (independent of the Rate knob) */
  deriv: [number, number, number];
}

let snapshot: LfoSnapshot = { state: [0, 0, 0], deriv: [0, 0, 0] };

/** Latest chaos LFO state and its derivative (the wild cat's brain reads this). */
export function lfoSnapshot(): LfoSnapshot {
  return snapshot;
}

export function startModulator(): { stop(): void } {
  let lfo = new ChaosLfo(useStore.getState().params.seed);
  let seed = useStore.getState().params.seed;
  let last = performance.now();

  const timer = setInterval(() => {
    const st = useStore.getState();
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!st.playing) return;
    if (st.params.seed !== seed) {
      seed = st.params.seed;
      lfo = new ChaosLfo(seed);
    }
    const before = lfo.state();
    const out = lfo.step(dt, st.chaos, st.now.sectionName);
    const after = lfo.state();
    // derivative per unit of attractor time, so it does not depend on the Rate knob
    const lt = Math.max(1e-6, speedFor(st.chaos.rate) * dt);
    snapshot = {
      state: after,
      deriv: [0, 1, 2].map((i) => Math.tanh((after[i]! - before[i]!) / lt / 6)) as [number, number, number],
    };
    // only publish when something visibly changed (keeps React quiet when the LFO is off)
    const prev = st.mod;
    let changed = false;
    const next: ModOffsets = {};
    for (const t of MOD_TARGETS) {
      const v = Math.round(out[t] * 1000) / 1000;
      if (v !== 0) next[t] = v;
      if ((prev[t] ?? 0) !== v) changed = true;
    }
    if (changed) st.setMod(next);
  }, TICK_MS);

  return { stop: () => clearInterval(timer) };
}
