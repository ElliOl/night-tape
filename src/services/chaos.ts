/**
 * Chaos LFO: a Lorenz attractor drives every modulation target. The attractor never repeats but moves smoothly, so
 * parameters wander like a human slowly riding the knobs rather than wobbling like a sine LFO. Each target reads its
 * own projection of the attractor (so they move together but differently), is smoothed with its own time constant,
 * and gets a section-aware bias ("smart": darker and roomier in breaks, brighter and busier in solos and themes).
 * Pure logic (no timers, no store) so it is unit-testable; services/modulator.ts runs it.
 */
import type { ChaosParams, ModTarget } from '@shared/index';

export const MOD_TARGETS: readonly ModTarget[] = [
  'cutoff', 'resonance', 'warmth', 'wow', 'crush', 'space', 'energy', 'complexity', 'variation', 'swing',
];
export const FILTER_TARGETS: readonly ModTarget[] = ['cutoff', 'resonance'];
export const TAPE_TARGETS: readonly ModTarget[] = ['warmth', 'wow', 'crush', 'space'];
export const GROOVE_TARGETS: readonly ModTarget[] = ['energy', 'complexity', 'variation', 'swing'];

/** Largest offset (in knob units 0..1) each target gets at amount = 1. */
const DEPTH: Record<ModTarget, number> = {
  cutoff: 0.45, resonance: 0.35, warmth: 0.3, wow: 0.35, crush: 0.25, space: 0.3,
  energy: 0.4, complexity: 0.35, variation: 0.4, swing: 0.25,
};

/** Smoothing time constant (s): the music-side targets move slower than the filter. */
const SMOOTH: Record<ModTarget, number> = {
  cutoff: 0.25, resonance: 0.4, warmth: 0.8, wow: 1, crush: 1, space: 1.5,
  energy: 2.5, complexity: 3, variation: 2.5, swing: 3,
};

/** Fixed projection of the (normalised) attractor state for each target. */
const PROJ: Record<ModTarget, readonly [number, number, number]> = {
  cutoff: [0.9, 0.4, 0.3],
  resonance: [-0.3, 0.8, 0.5],
  warmth: [0.5, -0.2, 0.8],
  wow: [-0.7, 0.2, 0.6],
  crush: [0.2, -0.9, 0.3],
  space: [-0.4, -0.5, 0.7],
  energy: [0.6, 0.7, -0.2],
  complexity: [-0.5, 0.4, -0.7],
  variation: [0.3, 0.3, 0.9],
  swing: [-0.8, -0.3, -0.4],
};

const QUIET = new Set(['Intro', 'Break', 'Outro', 'Dawn', 'Dusk']);
const BUSY = new Set(['Solo', 'Theme', 'Tide']);

/** Section bias per target (knob units, before the amount). */
export function sectionBias(section: string): Partial<Record<ModTarget, number>> {
  if (QUIET.has(section)) return { cutoff: -0.15, space: 0.12, energy: -0.12, warmth: -0.08 };
  if (BUSY.has(section)) return { cutoff: 0.08, energy: 0.12, complexity: 0.08, resonance: 0.05 };
  return {};
}

/** Lorenz attractor time units per second for rate 0..1 (slow drift .. restless). */
export const speedFor = (rate: number): number => 0.02 + Math.pow(Math.min(1, Math.max(0, rate)), 2) * 0.6;

export class ChaosLfo {
  private x = 0.1;
  private y = 0;
  private z = 20;
  private readonly smoothed = new Map<ModTarget, number>();

  constructor(seed = 1) {
    // different seeds start in different places on the attractor
    this.x = 0.1 + (seed % 97) / 50;
    this.y = ((seed * 7) % 31) / 10;
    for (let i = 0; i < 200; i++) this.integrate(0.01); // settle onto the attractor
  }

  private integrate(dt: number): void {
    const sigma = 10;
    const rho = 28;
    const beta = 8 / 3;
    const dx = sigma * (this.y - this.x);
    const dy = this.x * (rho - this.z) - this.y;
    const dz = this.x * this.y - beta * this.z;
    this.x += dx * dt;
    this.y += dy * dt;
    this.z += dz * dt;
  }

  /** Raw normalised attractor state (each roughly -1..1). */
  state(): [number, number, number] {
    return [this.x / 18, this.y / 24, (this.z - 24) / 16];
  }

  /**
   * Advance by `dt` seconds and return the offsets (knob units) per target. Disabled groups return 0
   * (and glide there smoothly).
   */
  step(dt: number, chaos: ChaosParams, section: string): Record<ModTarget, number> {
    const lorenzTime = speedFor(chaos.rate) * dt;
    const n = Math.max(1, Math.ceil(lorenzTime / 0.005));
    for (let i = 0; i < n; i++) this.integrate(lorenzTime / n);
    const [nx, ny, nz] = this.state();
    const bias = sectionBias(section);
    const amount = Math.min(1, Math.max(0, chaos.amount));
    const out = {} as Record<ModTarget, number>;
    for (const t of MOD_TARGETS) {
      const on = FILTER_TARGETS.includes(t) ? chaos.filter : TAPE_TARGETS.includes(t) ? chaos.tape : chaos.groove;
      const [a, b, c] = PROJ[t];
      const signal = Math.tanh(1.4 * (a * nx + b * ny + c * nz));
      const target = on ? amount * (DEPTH[t] * signal + (bias[t] ?? 0)) : 0;
      const prev = this.smoothed.get(t) ?? 0;
      const k = 1 - Math.exp(-dt / SMOOTH[t]);
      const v = prev + (target - prev) * k;
      this.smoothed.set(t, v);
      out[t] = Math.abs(v) < 1e-4 ? 0 : v;
    }
    return out;
  }
}

/**
 * Apply an offset to a knob value. Instead of clipping at the ends, the excess folds back, so a knob parked at 0 or 1
 * still moves audibly when the LFO pushes past the end.
 */
export function applyMod(base: number, offset: number): number {
  let v = base + offset;
  if (v > 1) v = 2 - v;
  if (v < 0) v = -v;
  return Math.min(1, Math.max(0, v));
}
