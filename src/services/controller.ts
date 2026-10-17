/**
 * Thin seam between the UI and the playback system (Conductor). main.tsx registers the implementation.
 */
export interface PlaybackController {
  /** First call must come from a user gesture (initialises audio). */
  play(): Promise<void>;
  pause(): void;
  /** Re-seed (optional new seed) and restart with a smooth fade. */
  regenerate(newSeed?: number): Promise<void>;
  /** Offline render N bars to a WAV download. */
  exportWav(bars: number): Promise<void>;
}

let current: PlaybackController | null = null;

export function setController(c: PlaybackController): void {
  current = c;
}

export function tryGetController(): PlaybackController | null {
  return current;
}
