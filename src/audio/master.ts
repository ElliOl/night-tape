import * as Tone from 'tone';
import type { MoodId, TapeParams } from '@shared/index';
import { DEFAULT_TAPE } from '@shared/index';
import { clamp01, crushCurve, dbToGain, faderToGain, logMap, masterFilterHz, safeCutoff, saturationCurve } from './mapping';
import { getPreset } from './presets';
import { rampParam } from './instruments/instrument';

/** Analyser size: 512 frequency bins (fftSize 1024). */
export const FFT_SIZE = 512;

export interface MasterOptions {
  analysis?: boolean;
  toDestination?: boolean;
}

/** warmth 0..1 -> tape low-pass cutoff (Hz): 0 = muffled 1.6 kHz, 1 = open 18 kHz. */
export const warmthHz = (warmth: number): number => logMap(clamp01(warmth), 1600, 18000);
/** wow 0..1 -> vibrato depth of the slow (wow) and fast (flutter) modulators. */
export const wowDepths = (wow: number): { wow: number; flutter: number } => {
  const x = clamp01(wow);
  return { wow: x * 0.7, flutter: x * 0.22 };
};

/**
 * Master "tape machine":
 *   input -> 35 Hz low-cut -> (dry | bit-crush path) -> wow -> flutter -> tape saturation -> warmth low-pass
 *   -> transition low-pass ('master.filter') -> glue compressor -> limiter -> fade -> volume -> analysers + out
 */
export class TapeMaster {
  readonly input: Tone.Gain;
  readonly output: Tone.Gain;

  private readonly lowCut: Tone.Filter;
  private readonly dry: Tone.Gain;
  private readonly crusher: Tone.WaveShaper;
  private readonly crushLp: Tone.Filter;
  private readonly crushWet: Tone.Gain;
  private readonly sum: Tone.Gain;
  private readonly wow: Tone.Vibrato;
  private readonly flutter: Tone.Vibrato;
  private readonly saturator: Tone.WaveShaper;
  private readonly warmth: Tone.Filter;
  private readonly lp: Tone.Filter;
  private readonly compressor: Tone.Compressor;
  private readonly limiter: Tone.Limiter;
  private readonly fade: Tone.Gain;
  private readonly volume: Tone.Gain;

  private readonly mono: Tone.Mono | null = null;
  private readonly fft: Tone.Analyser | null = null;
  private readonly wave: Tone.Analyser | null = null;
  private readonly emptySpectrum = new Float32Array(FFT_SIZE).fill(-140);
  private levelSmoothed = 0;
  private lastLevelTime = 0;
  private drive: number;

  constructor(mood: MoodId, opts: MasterOptions & { volume?: number } = {}) {
    const sr = Tone.getContext().sampleRate;
    const t = getPreset(mood).tape;
    this.drive = t.drive;
    // makeup gain into the tape: the synths are mixed with headroom, the compressor + limiter catch the peaks
    this.input = new Tone.Gain(dbToGain(5));
    this.lowCut = new Tone.Filter({ type: 'highpass', frequency: 35, Q: 0.7, rolloff: -12 });
    this.dry = new Tone.Gain(1);
    this.crusher = new Tone.WaveShaper(crushCurve(7));
    this.crushLp = new Tone.Filter({ type: 'lowpass', frequency: 6000, Q: 0.5, rolloff: -24 });
    this.crushWet = new Tone.Gain(0);
    this.sum = new Tone.Gain(1);
    const d = wowDepths(DEFAULT_TAPE.wow);
    this.wow = new Tone.Vibrato({ frequency: t.wowRate, depth: d.wow, maxDelay: 0.006, type: 'sine' });
    this.flutter = new Tone.Vibrato({ frequency: t.flutterRate, depth: d.flutter, maxDelay: 0.0015, type: 'triangle' });
    this.saturator = new Tone.WaveShaper(saturationCurve(t.drive), 2048);
    this.saturator.oversample = '2x';
    this.warmth = new Tone.Filter({ type: 'lowpass', frequency: safeCutoff(warmthHz(DEFAULT_TAPE.warmth), sr), Q: 0.6, rolloff: -12 });
    this.lp = new Tone.Filter({ type: 'lowpass', frequency: masterFilterHz(1, sr), Q: 0.5, rolloff: -12 });
    this.compressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.02, release: 0.25, knee: 10 });
    this.limiter = new Tone.Limiter(-1);
    this.fade = new Tone.Gain(1);
    this.volume = new Tone.Gain(faderToGain(opts.volume ?? 0.8));
    this.output = new Tone.Gain(1);

    this.input.connect(this.lowCut);
    this.lowCut.connect(this.dry);
    this.lowCut.chain(this.crusher, this.crushLp, this.crushWet);
    this.dry.connect(this.sum);
    this.crushWet.connect(this.sum);
    this.sum.chain(
      this.wow, this.flutter, this.saturator, this.warmth, this.lp, this.compressor, this.limiter, this.fade, this.volume, this.output,
    );

    if (opts.analysis !== false) {
      this.mono = new Tone.Mono();
      this.fft = new Tone.Analyser({ type: 'fft', size: FFT_SIZE, smoothing: 0.8, channels: 1 });
      this.wave = new Tone.Analyser({ type: 'waveform', size: 512, channels: 1 });
      this.output.connect(this.mono);
      this.mono.connect(this.fft);
      this.mono.connect(this.wave);
    }
    if (opts.toDestination !== false) this.output.toDestination();
  }

  /** User tape controls (warmth / wow / crush). Ambience and space are handled by texture / fx. */
  setTape(tape: TapeParams, time = Tone.now(), rampSeconds = 0.12): void {
    const sr = Tone.getContext().sampleRate;
    rampParam(this.warmth.frequency, safeCutoff(warmthHz(tape.warmth), sr), time, rampSeconds);
    const d = wowDepths(tape.wow);
    rampParam(this.wow.depth, d.wow, time, rampSeconds);
    rampParam(this.flutter.depth, d.flutter, time, rampSeconds);
    const c = clamp01(tape.crush);
    rampParam(this.crushWet.gain, c * 0.85, time, rampSeconds);
    rampParam(this.dry.gain, 1 - c * 0.7, time, rampSeconds);
  }

  setMood(mood: MoodId, rampSeconds: number): void {
    const t = getPreset(mood).tape;
    const now = Tone.now();
    rampParam(this.wow.frequency, t.wowRate, now, rampSeconds);
    rampParam(this.flutter.frequency, t.flutterRate, now, rampSeconds);
    if (t.drive !== this.drive) {
      this.drive = t.drive;
      this.saturator.curve = saturationCurve(t.drive);
    }
  }

  setVolume(fader01: number, time = Tone.now(), rampSeconds = 0.05): void {
    rampParam(this.volume.gain, faderToGain(fader01), time, rampSeconds);
  }

  fadeTo(gain01: number, time = Tone.now(), rampSeconds = 0.08): void {
    rampParam(this.fade.gain, clamp01(gain01), time, rampSeconds);
  }

  /** 'master.filter' automation, 0..1, 1 = open */
  setFilter(value01: number, time: number, rampSeconds: number): void {
    rampParam(this.lp.frequency, masterFilterHz(value01, Tone.getContext().sampleRate), time, rampSeconds);
  }

  getSpectrum(): Float32Array {
    return this.fft ? (this.fft.getValue() as Float32Array) : this.emptySpectrum;
  }

  /** Smoothed peak level 0..1 (fast attack, ~250 ms release). */
  getLevel(): number {
    if (!this.wave) return 0;
    const buf = this.wave.getValue() as Float32Array;
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]!));
    const nowMs = performance.now();
    const dt = this.lastLevelTime ? Math.min(0.5, (nowMs - this.lastLevelTime) / 1000) : 0.016;
    this.lastLevelTime = nowMs;
    this.levelSmoothed = Math.max(peak, this.levelSmoothed * Math.exp(-dt / 0.25));
    return clamp01(this.levelSmoothed);
  }

  dispose(): void {
    for (const n of [
      this.input, this.lowCut, this.dry, this.crusher, this.crushLp, this.crushWet, this.sum, this.wow, this.flutter,
      this.saturator, this.warmth, this.lp, this.compressor, this.limiter, this.fade, this.volume, this.output,
    ]) {
      n.dispose();
    }
    this.mono?.dispose();
    this.fft?.dispose();
    this.wave?.dispose();
  }
}
