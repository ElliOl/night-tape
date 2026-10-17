import type { EventBatch, GenerationParams } from '@shared/index';

/**
 * Composition engine contract (no Tone.js / DOM).
 *  - init() resets all state; the same seed + same sequence of params gives the same output.
 *  - renderBars() is called with strictly consecutive bars and reads the CURRENT params, so live
 *    control changes are heard within a few bars.
 */
export interface ComposerEngine {
  init(seed: number, params: GenerationParams): void;
  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch;
}
