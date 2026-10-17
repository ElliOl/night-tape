/** Knob values after chaos modulation (what the composer and the renderer actually use). */
import type { GenerationParams, ModTarget, TapeParams } from '@shared/index';
import { applyMod, FILTER_TARGETS, GROOVE_TARGETS, TAPE_TARGETS } from './chaos';

export type ModOffsets = Partial<Record<ModTarget, number>>;

export function effectiveTape(tape: TapeParams, mod: ModOffsets): TapeParams {
  const out = { ...tape };
  for (const t of [...FILTER_TARGETS, ...TAPE_TARGETS] as Array<keyof TapeParams & ModTarget>) {
    const off = mod[t];
    if (off) out[t] = applyMod(tape[t], off);
  }
  return out;
}

export function effectiveParams(params: GenerationParams, mod: ModOffsets): GenerationParams {
  const out = { ...params };
  for (const t of GROOVE_TARGETS as Array<'energy' | 'complexity' | 'variation' | 'swing'>) {
    const off = mod[t];
    if (off) out[t] = applyMod(params[t], off);
  }
  return out;
}
