import type { EventBatch, GenerationParams, MixerParams, TapeParams } from '@shared/index';
import { audioBufferToWav, renderOffline } from '../audio/offline';
import type { ComposerEngine } from './types';

/**
 * Render `bars` bars of a fresh composition (same seed/params) faster than real time and download a WAV.
 * Uses a separate engine instance, so live playback is untouched.
 */
export async function exportWav(
  engine: ComposerEngine,
  params: GenerationParams,
  mixer: MixerParams,
  tape: TapeParams,
  bars: number,
): Promise<void> {
  engine.init(params.seed, params);
  const batches: EventBatch[] = [];
  for (let bar = 0; bar < bars; bar++) batches.push(engine.renderBars(bar, 1, params));
  const tempo = batches[0]?.tempo ?? params.tempo ?? 80;
  const buffer = await renderOffline(batches, bars, tempo, params.mood, mixer, tape);
  const url = URL.createObjectURL(audioBufferToWav(buffer));
  const a = document.createElement('a');
  a.href = url;
  a.download = `night-tape_${params.mood}_${params.seed}_${bars}bars.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
