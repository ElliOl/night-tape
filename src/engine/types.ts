import type { EventBatch, GenerationParams } from '@shared/index';

/**
 * Composition engine contract (no Tone.js / DOM).
 *  - init() resets all state; the same seed + same sequence of params gives the same output.
 *  - renderBars() is called with consecutive bars and reads the CURRENT params.
 *  - rewind(bar) lets the conductor re-render already scheduled bars when a groove control moves, so the
 *    change is heard almost immediately (song plans are kept; only the playing changes).
 */
export interface ComposerEngine {
  init(seed: number, params: GenerationParams): void;
  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch;
  rewind(bar: number): void;
}
