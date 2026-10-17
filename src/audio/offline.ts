import * as Tone from 'tone';
import type { EventBatch, FilterMode, MixerParams, MoodId, TapeParams } from '@shared/index';
import { AudioGraph } from './graph';
import { TempoMap, clampBpm, secondsPerBeat } from './mapping';
import { Scheduler, TEMPO_RAMP_BEATS, type SchedulerHost } from './scheduler';

export { audioBufferToWav } from './wav';

/** Extra seconds rendered after the last bar so reverb/echo tails are not cut. */
export const OFFLINE_TAIL_SECONDS = 4;

/**
 * Render `bars` bars of the given batches through the same graph used for realtime playback, inside a
 * Tone.Offline context (faster than real time). Returns a stereo buffer including a short tail.
 */
export async function renderOffline(
  batches: EventBatch[],
  bars: number,
  tempo: number,
  mood: MoodId,
  mixer: MixerParams,
  tape: TapeParams,
  filterMode: FilterMode = 'lowpass',
): Promise<AudioBuffer> {
  const ordered = [...batches].sort((a, b) => a.startBeat - b.startBeat);
  const totalBeats = Math.max(1, bars) * 4;
  const bpm0 = clampBpm(tempo);

  const tm = new TempoMap(bpm0);
  let lastBpm = bpm0;
  for (const b of ordered) {
    const bpm = clampBpm(b.tempo);
    if (Math.abs(bpm - lastBpm) > 0.01 && b.startBeat > 0 && b.startBeat < totalBeats) {
      tm.addChange(b.startBeat, bpm, TEMPO_RAMP_BEATS * secondsPerBeat(bpm));
      lastBpm = bpm;
    }
  }
  const duration = tm.beatToSeconds(totalBeats) + OFFLINE_TAIL_SECONDS;

  const rendered = await Tone.Offline((ctx) => {
    const graph = new AudioGraph({ mood, mixer, tape, analysis: false });
    graph.setFilterMode(filterMode);
    const host: SchedulerHost = {
      onNote: (ev, time, dur) => graph.trigger(ev.layer, ev.midi, dur, time, ev.vel),
      onAutomation: (ev, time, ramp) => graph.automate(ev.target, ev.value, time, ramp),
      onTempo: (bpm, time, ramp) => graph.setTempo(bpm, time, ramp),
      onPatch: (ev, time) => graph.applyPalette(ev.palette, 0, time),
    };
    const transport = ctx.transport;
    transport.bpm.value = bpm0;
    const scheduler = new Scheduler(transport, host, ctx);
    scheduler.schedule({ version: 1, startBeat: 0, endBeat: 0, tempo: bpm0, timeSig: [4, 4], events: [] });
    for (const b of ordered) {
      if (b.startBeat >= totalBeats) continue;
      scheduler.schedule({ ...b, events: b.events.filter((e) => e.beat < totalBeats) });
    }
    scheduler.play(0);
  }, duration, 2);

  return rendered.get() as AudioBuffer;
}
