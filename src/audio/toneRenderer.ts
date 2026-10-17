import * as Tone from 'tone';
import {
  DEFAULT_MIXER, DEFAULT_TAPE, type EventBatch, type FilterMode, type LayerId, type MixerParams, type MoodId, type TapeParams,
} from '@shared/index';
import type { AudioRenderer } from './types';
import { AudioGraph } from './graph';
import { Scheduler, type SchedulerHost } from './scheduler';

const PAUSE_FADE = 0.08;

/** Tone's global context is replaced at most once. */
let contextConfigured = false;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Tone.js implementation of AudioRenderer.
 * Usage: `await start()` (user gesture) -> setMood/setMixer/setTape (any time) -> schedule(batch) -> play().
 */
export class ToneRenderer implements AudioRenderer {
  private graph: AudioGraph | null = null;
  private scheduler: Scheduler | null = null;
  private startPromise: Promise<void> | null = null;
  private mood: MoodId = 'study';
  private mixer: MixerParams = { ...DEFAULT_MIXER };
  private tape: TapeParams = { ...DEFAULT_TAPE };
  private readonly muted = new Set<LayerId>();
  private filterMode: FilterMode = 'lowpass';
  private backlog: EventBatch[] = [];
  private resetChain: Promise<void> = Promise.resolve();
  private disposed = false;

  start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.doStart().catch((err) => {
        this.startPromise = null; // allow retry
        throw err;
      });
    }
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    if (this.disposed) throw new Error('ToneRenderer disposed');
    if (!this.graph && !contextConfigured) {
      contextConfigured = true;
      // a larger buffer + lookahead is far more robust for hours of generative playback
      try {
        Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0.15 }), true);
      } catch {
        // keep Tone's default context
      }
    }
    await Tone.start();
    if (this.disposed) throw new Error('ToneRenderer disposed');
    if (!this.graph) {
      const graph = new AudioGraph({ mood: this.mood, mixer: this.mixer, tape: this.tape, muted: this.muted });
      this.graph = graph;
      graph.setFilterMode(this.filterMode);
      const host: SchedulerHost = {
        onNote: (ev, time, dur) => graph.trigger(ev.layer, ev.midi, dur, time, ev.vel),
        onAutomation: (ev, time, ramp) => graph.automate(ev.target, ev.value, time, ramp),
        onTempo: (bpm, time, ramp) => graph.setTempo(bpm, time, ramp),
        onPatch: (ev, time) => graph.applyPalette(ev.palette, 1.2, time),
      };
      this.scheduler = new Scheduler(Tone.getTransport(), host);
    }
    for (const b of this.backlog) this.scheduler!.schedule(b);
    this.backlog = [];
  }

  play(): void {
    const g = this.graph;
    const s = this.scheduler;
    if (!g || !s || this.disposed) return;
    const ctx = Tone.getContext();
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    g.setPlayGate(true, Tone.now(), PAUSE_FADE);
    // re-assert the mix (cheap; guards against values dropped while the context was starting)
    g.setMixer(this.mixer);
    g.setTape(this.tape);
    s.play();
  }

  pause(): void {
    const g = this.graph;
    const s = this.scheduler;
    if (!g || !s || this.disposed || !s.isPlaying()) return;
    s.pause();
    const now = Tone.now();
    g.setPlayGate(false, now, PAUSE_FADE);
    g.releaseAll(now + PAUSE_FADE + 0.02);
  }

  schedule(batch: EventBatch): void {
    if (this.disposed) return;
    if (!this.scheduler) this.backlog.push(batch);
    else this.scheduler.schedule(batch);
  }

  cancelFrom(beat: number): void {
    this.scheduler?.cancelFrom(beat);
  }

  setFilterMode(mode: FilterMode): void {
    this.filterMode = mode;
    this.graph?.setFilterMode(mode);
  }

  reset(fadeSeconds = 1.2): Promise<void> {
    this.resetChain = this.resetChain.then(() => this.doReset(fadeSeconds)).catch(() => undefined);
    return this.resetChain;
  }

  private async doReset(fadeSeconds: number): Promise<void> {
    this.backlog = [];
    const g = this.graph;
    const s = this.scheduler;
    if (!g || !s || this.disposed) return;
    const fade = Math.max(0.05, fadeSeconds);

    // 1. fade everything out; stop the echo from regenerating while it drains
    const t0 = Tone.now();
    g.master.fadeTo(0, t0, fade);
    g.fx.setFeedbackEnabled(false, t0, Math.min(0.2, fade));
    await sleep(fade * 1000 + 80);
    if (this.disposed) return;

    // 2. silent: cancel everything and rewind
    s.stopAndRewind();
    const t1 = Tone.now();
    g.releaseAll(t1 + 0.25);
    g.fx.setReturnsMuted(true, t1, 0.01);
    g.resetAutomationState();
    g.fx.flushReverb();
    await sleep(380);
    g.setPlayGate(true, Tone.now(), 0.01);
    if (this.disposed) return;

    // 3. restore the returns and fade back in
    const t2 = Tone.now();
    g.fx.setFeedbackEnabled(true, t2, 0.05);
    g.fx.setReturnsMuted(false, t2, 0.3);
    g.master.fadeTo(1, t2, 0.3);
  }

  getBeat(): number {
    return this.scheduler ? this.scheduler.getBeat() : 0;
  }

  setMood(mood: MoodId): void {
    this.mood = mood;
    this.graph?.setMood(mood);
  }

  setMixer(mixer: MixerParams): void {
    this.mixer = { ...mixer };
    this.graph?.setMixer(this.mixer);
  }

  setTape(tape: TapeParams): void {
    this.tape = { ...tape };
    this.graph?.setTape(this.tape);
  }

  setLayerMuted(layer: LayerId, muted: boolean): void {
    if (muted) this.muted.add(layer);
    else this.muted.delete(layer);
    this.graph?.setLayerMuted(layer, muted);
  }

  getSpectrum(): Float32Array {
    return this.graph ? this.graph.master.getSpectrum() : EMPTY_SPECTRUM;
  }

  getLevel(): number {
    return this.graph ? this.graph.master.getLevel() : 0;
  }

  /** Diagnostics for the dev console. */
  getDebugStats(): { pendingEvents: number; beat: number; playing: boolean; callbackErrors: number } {
    const s = this.scheduler;
    return {
      pendingEvents: s ? s.pendingCount : 0,
      beat: this.getBeat(),
      playing: s ? s.isPlaying() : false,
      callbackErrors: s ? s.errorCount : 0,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler?.dispose();
    this.graph?.dispose();
    this.scheduler = null;
    this.graph = null;
    this.backlog = [];
  }
}

const EMPTY_SPECTRUM = new Float32Array(512).fill(-140);

export function createRenderer(): ToneRenderer {
  return new ToneRenderer();
}
