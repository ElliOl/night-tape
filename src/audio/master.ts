import * as Tone from 'tone';
import type { FilterMode, MoodId, TapeParams } from '@shared/index';
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

/** warmth 0..1 -> tape low-pass cutoff (Hz): 0 = very muffled 500 Hz, 1 = open 20 kHz. */
export const warmthHz = (warmth: number): number => logMap(clamp01(warmth), 500, 20000);
/** wow 0..1 -> vibrato depth of the slow (wow) and fast (flutter) modulators (max delay 12 ms / 3 ms). */
export const wowDepths = (wow: number): { wow: number; flutter: number } => {
  const x = clamp01(wow);
  return { wow: x * 0.75, flutter: x * 0.4 };
};
/** master filter cutoff 0..1 -> Hz (log 40 Hz .. 20 kHz). */
export const cutoffHz = (cutoff: number): number => logMap(clamp01(cutoff), 40, 20000);
/**
 * master filter resonance 0..1 -> Q. Low/high-pass: 0.5 .. 18 (curved so the top of the knob screams).
 * Band-pass: Q is its bandwidth, so it gets a gentler 0.6 .. 6 range or it would vanish.
 */
export const resonanceQ = (res: number, mode: FilterMode = 'lowpass'): number =>
  mode === 'bandpass' ? 0.6 + 5.4 * Math.pow(clamp01(res), 1.3) : 0.5 + 17.5 * Math.pow(clamp01(res), 1.6);
/** level compensation (dB): tame resonant peaks, make up the energy a band-pass removes. */
export const resonanceTrimDb = (q: number, mode: FilterMode = 'lowpass'): number =>
  mode === 'bandpass' ? 8 + Math.min(10, q * 1.6) : -Math.min(6, Math.max(0, q - 0.7) * 0.35);

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
  private readonly userFilter: Tone.Filter;
  private readonly userTrim: Tone.Gain;
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
  private mode: FilterMode = 'lowpass';
  private lastTape: TapeParams = { ...DEFAULT_TAPE };
  /** audio time until which the acid filter owns the master filter (setTape leaves it alone) */
  private acidUntil = 0;

  constructor(mood: MoodId, opts: MasterOptions & { volume?: number } = {}) {
    const sr = Tone.getContext().sampleRate;
    const t = getPreset(mood).tape;
    this.drive = t.drive;
    // makeup gain into the tape: the synths are mixed with headroom, the compressor + limiter catch the peaks
    this.input = new Tone.Gain(dbToGain(5));
    this.lowCut = new Tone.Filter({ type: 'highpass', frequency: 35, Q: 0.7, rolloff: -12 });
    this.dry = new Tone.Gain(1);
    this.crusher = new Tone.WaveShaper(crushCurve(5));
    this.crushLp = new Tone.Filter({ type: 'lowpass', frequency: 6000, Q: 0.5, rolloff: -24 });
    this.crushWet = new Tone.Gain(0);
    this.sum = new Tone.Gain(1);
    const d = wowDepths(DEFAULT_TAPE.wow);
    this.wow = new Tone.Vibrato({ frequency: t.wowRate, depth: d.wow, maxDelay: 0.012, type: 'sine' });
    this.flutter = new Tone.Vibrato({ frequency: t.flutterRate, depth: d.flutter, maxDelay: 0.003, type: 'triangle' });
    this.saturator = new Tone.WaveShaper(saturationCurve(t.drive), 2048);
    this.saturator.oversample = '2x';
    this.warmth = new Tone.Filter({ type: 'lowpass', frequency: safeCutoff(warmthHz(DEFAULT_TAPE.warmth), sr), Q: 0.6, rolloff: -12 });
    const q0 = resonanceQ(DEFAULT_TAPE.resonance);
    this.userFilter = new Tone.Filter({ type: 'lowpass', frequency: safeCutoff(cutoffHz(DEFAULT_TAPE.cutoff), sr), Q: q0, rolloff: -12 });
    this.userTrim = new Tone.Gain(dbToGain(resonanceTrimDb(q0)));
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
      this.wow, this.flutter, this.saturator, this.warmth, this.userFilter, this.userTrim, this.lp, this.compressor, this.limiter, this.fade, this.volume, this.output,
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

  /** User tape + master filter controls. Ambience and space are handled by texture / fx. */
  setTape(tape: TapeParams, time = Tone.now(), rampSeconds = 0.12): void {
    const sr = Tone.getContext().sampleRate;
    rampParam(this.warmth.frequency, safeCutoff(warmthHz(tape.warmth), sr), time, rampSeconds);
    const d = wowDepths(tape.wow);
    rampParam(this.wow.depth, d.wow, time, rampSeconds);
    rampParam(this.flutter.depth, d.flutter, time, rampSeconds);
    const c = clamp01(tape.crush);
    rampParam(this.crushWet.gain, c, time, rampSeconds);
    rampParam(this.dry.gain, 1 - c * 0.95, time, rampSeconds);
    // more crush also lowers the "sample rate" (darker, more aliasing-like)
    rampParam(this.crushLp.frequency, logMap(1 - c, 2200, 9000), time, rampSeconds);
    this.lastTape = { ...tape };
    if (Tone.now() < this.acidUntil) return;
    const q = resonanceQ(tape.resonance, this.mode);
    rampParam(this.userFilter.frequency, safeCutoff(cutoffHz(tape.cutoff), sr), time, rampSeconds);
    rampParam(this.userFilter.Q, q, time, rampSeconds);
    rampParam(this.userTrim.gain, dbToGain(resonanceTrimDb(q, this.mode)), time, rampSeconds);
  }

  /** Acid section starts at `time` and lasts `seconds`: the master filter becomes a squelchy resonant low-pass. */
  acidBegin(time: number, seconds: number): void {
    this.acidUntil = Math.max(this.acidUntil, time + seconds);
    this.userFilter.type = 'lowpass';
    this.userFilter.frequency.cancelScheduledValues(time);
    this.userFilter.Q.cancelScheduledValues(time);
    this.userTrim.gain.cancelScheduledValues(time);
    this.userTrim.gain.setValueAtTime(dbToGain(-5), time);
  }

  /**
   * One 16th of TB-303 style filter: the cutoff snaps open and decays over the step. Accented steps open further and
   * ring harder. `intensity` 0..1 scales how wide it opens.
   */
  acidStep(time: number, seconds: number, accent: boolean, intensity: number): void {
    const sr = Tone.getContext().sampleRate;
    const base = 260 + 160 * intensity;
    const peak = base * (accent ? 9 + 7 * intensity : 4 + 3 * intensity);
    const f = this.userFilter.frequency;
    f.setValueAtTime(safeCutoff(peak, sr), time);
    f.exponentialRampToValueAtTime(safeCutoff(base, sr), time + seconds * 0.92);
    this.userFilter.Q.setValueAtTime(accent ? 15 : 10, time);
  }

  /** Hand the filter back to the knobs (smoothly) at `time`. */
  acidEnd(time: number): void {
    this.acidUntil = 0;
    this.userFilter.type = this.mode;
    const sr = Tone.getContext().sampleRate;
    const q = resonanceQ(this.lastTape.resonance, this.mode);
    this.userFilter.frequency.cancelScheduledValues(time);
    this.userFilter.Q.cancelScheduledValues(time);
    rampParam(this.userFilter.frequency, safeCutoff(cutoffHz(this.lastTape.cutoff), sr), time, 0.4);
    rampParam(this.userFilter.Q, q, time, 0.4);
    rampParam(this.userTrim.gain, dbToGain(resonanceTrimDb(q, this.mode)), time, 0.4);
  }

  setFilterMode(mode: FilterMode): void {
    this.mode = mode;
    if (Tone.now() < this.acidUntil) return; // applied when the acid section ends
    this.userFilter.type = mode;
    this.setTape(this.lastTape, Tone.now(), 0.05);
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
      this.saturator, this.warmth, this.userFilter, this.userTrim, this.lp, this.compressor, this.limiter, this.fade, this.volume, this.output,
    ]) {
      n.dispose();
    }
    this.mono?.dispose();
    this.fft?.dispose();
    this.wave?.dispose();
  }
}
