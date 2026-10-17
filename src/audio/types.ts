import type { EventBatch, FilterMode, LayerId, MixerParams, MoodId, TapeParams } from '@shared/index';

/**
 * Audio renderer contract. The Tone.js implementation lives in toneRenderer.ts; nothing outside audio/ imports Tone.
 * Beats are absolute from song start. After reset() the beat clock returns to 0.
 */
export interface AudioRenderer {
  /** Must be called from a user gesture. Resolves when the AudioContext is running. Idempotent. */
  start(): Promise<void>;
  play(): void;
  /** Pause the clock; sustained notes are released smoothly, reverb tails keep ringing. */
  pause(): void;
  /** Queue a batch (in order). Its tempo takes effect at batch.startBeat with a smooth ramp. */
  schedule(batch: EventBatch): void;
  /** Cancel everything scheduled at or after `beat` (to re-render the near future). */
  cancelFrom(beat: number): void;
  /** Fade out, cancel everything, rewind to beat 0, fade back in. */
  reset(fadeSeconds?: number): Promise<void>;
  /** Current audible position in beats. */
  getBeat(): number;

  setMood(mood: MoodId): void;
  setMixer(mixer: MixerParams): void;
  setTape(tape: TapeParams): void;
  setLayerMuted(layer: LayerId, muted: boolean): void;
  setFilterMode(mode: FilterMode): void;

  /** dB spectrum of the master output (reused array). */
  getSpectrum(): Float32Array;
  /** Peak level 0..1 of the master output. */
  getLevel(): number;
  dispose(): void;
}
