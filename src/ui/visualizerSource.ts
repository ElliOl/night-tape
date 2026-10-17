/**
 * Injection point so the UI can draw audio-reactive visuals without importing the audio layer.
 */
export interface VisualizerSource {
  /** dB spectrum, low frequency first, 0..Nyquist. Reused array. */
  getSpectrum(): Float32Array;
  /** Master output level 0..1. */
  getLevel(): number;
}

let source: VisualizerSource | null = null;

export function setVisualizerSource(src: VisualizerSource | null): void {
  source = src;
}

export function getVisualizerSource(): VisualizerSource | null {
  return source;
}
