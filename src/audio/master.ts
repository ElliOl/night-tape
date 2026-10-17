import * as Tone from 'tone';
import type { FilterMode, MoodId, TapeParams } from '@shared/index';
import { DEFAULT_TAPE } from '@shared/index';
import { TUBE_RANGE, clamp01, dbToGain, faderToGain, logMap, masterFilterHz, safeCutoff, saturationCurve, tubeCurve } from './mapping';
import { Crusher, crushSettings } from './crusher';
import { dropoutSamples } from './instruments/textureBuffers';
import { getPreset } from './presets';
import { rampParam } from './instruments/instrument';

/** Analyser size: 512 frequency bins (fftSize 1024). */
export const FFT_SIZE = 512;

export interface MasterOptions {
  analysis?: boolean;
  toDestination?: boolean;
}

/** warmth above this goes from warm tube into overdrive */
const OVERDRIVE_FROM = 0.7;
/**
 * warmth 0..1 -> tube stage: 0 = clean and open, ~0.7 = warm driven valve with a fat low end and soft top,
 * 1 = cranked overdrive. `drive` is the gain into the (fixed) tube curve; `trim` follows 1/drive (only the peaks
 * squash) until the overdrive zone, where it lets the distortion come forward instead of hiding it.
 */
export const warmthSettings = (warmth: number): { drive: number; trim: number; lowDb: number; highDb: number; lpHz: number } => {
  const w = clamp01(warmth);
  const od = Math.max(0, w - OVERDRIVE_FROM) / (1 - OVERDRIVE_FROM);
  const tubeDrive = 0.05 + 2.4 * Math.pow(w, 1.5);
  const drive = tubeDrive * (1 + 9 * od * od);
  return {
    drive,
    trim: 1 / (tubeDrive * Math.pow(drive / tubeDrive, 0.2)),
    // overdrive needs its mids and some bite: ease the bass bump and the darkening back off at the top
    lowDb: 6 * Math.min(w, OVERDRIVE_FROM) / OVERDRIVE_FROM - 2 * od,
    highDb: -8 * Math.pow(Math.min(w, OVERDRIVE_FROM) / OVERDRIVE_FROM, 1.2) + 3 * od,
    lpHz: logMap(1 - Math.min(w, OVERDRIVE_FROM), 4500, 20000) * (1 + 0.6 * od),
  };
};
/** wear 0..1 -> tape dropouts: how far the level dips (0..1 of it) and how dull it goes (Hz pulled off 18 kHz). */
export const wearDropouts = (wear: number): { dip: number; dullHz: number } => {
  const w = clamp01(wear);
  return { dip: 0.8 * Math.pow(w, 1.6), dullHz: 15500 * Math.pow(w, 1.1) };
};
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
 *   input -> 35 Hz low-cut -> (dry | decimator path) -> wow -> flutter -> tube (warmth) -> tape saturation
 *   -> warmth tone (low shelf, high shelf, low-pass)
 *   -> transition low-pass ('master.filter') -> glue compressor -> wear dropouts (after the compressor so it can't undo the dips) -> limiter -> fade -> volume -> analysers + out
 */
export class TapeMaster {
  readonly input: Tone.Gain;
  readonly output: Tone.Gain;

  private readonly lowCut: Tone.Filter;
  private readonly dry: Tone.Gain;
  private readonly crusher: Crusher;
  private readonly crushLp: Tone.Filter;
  private readonly crushWet: Tone.Gain;
  private readonly sum: Tone.Gain;
  private readonly wow: Tone.Vibrato;
  private readonly flutter: Tone.Vibrato;
  private readonly wearGain: Tone.Gain;
  private readonly wearLp: Tone.Filter;
  private readonly dropouts: Tone.Player;
  private readonly dipDepth: Tone.Gain;
  private readonly dullDepth: Tone.Gain;
  private readonly tubeDrive: Tone.Gain;
  private readonly tube: Tone.WaveShaper;
  private readonly tubeTrim: Tone.Gain;
  private readonly dcBlock: Tone.Filter;
  private readonly saturator: Tone.WaveShaper;
  private readonly warmLow: Tone.Filter;
  private readonly warmHigh: Tone.Filter;
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
    this.crusher = new Crusher();
    this.crushLp = new Tone.Filter({ type: 'lowpass', frequency: 12000, Q: 0.5, rolloff: -12 });
    this.crushWet = new Tone.Gain(0);
    this.sum = new Tone.Gain(1);
    const d = wowDepths(DEFAULT_TAPE.wow);
    this.wow = new Tone.Vibrato({ frequency: t.wowRate, depth: d.wow, maxDelay: 0.012, type: 'sine' });
    this.flutter = new Tone.Vibrato({ frequency: t.flutterRate, depth: d.flutter, maxDelay: 0.003, type: 'triangle' });
    // wear: a looping dropout envelope modulates level and brightness (worn spots passing the head)
    this.wearGain = new Tone.Gain(1);
    this.wearLp = new Tone.Filter({ type: 'lowpass', frequency: 18000, Q: 0.5, rolloff: -12 });
    const dropBuf = Tone.getContext().createBuffer(1, Math.floor(sr * 13.7), sr);
    dropBuf.getChannelData(0).set(dropoutSamples(sr, 13.7, 0xd20b, 0.7));
    this.dropouts = new Tone.Player(new Tone.ToneAudioBuffer(dropBuf));
    this.dropouts.loop = true;
    const wd = wearDropouts(DEFAULT_TAPE.vinyl);
    this.dipDepth = new Tone.Gain(-wd.dip);
    this.dullDepth = new Tone.Gain(-wd.dullHz);
    this.dropouts.connect(this.dipDepth);
    this.dropouts.connect(this.dullDepth);
    this.dipDepth.connect(this.wearGain.gain);
    this.dullDepth.connect(this.wearLp.frequency);
    this.dropouts.start();
    const w0 = warmthSettings(DEFAULT_TAPE.warmth);
    this.tubeDrive = new Tone.Gain(w0.drive / TUBE_RANGE);
    this.tube = new Tone.WaveShaper(tubeCurve(), 4096);
    this.tube.oversample = '2x';
    this.tubeTrim = new Tone.Gain(w0.trim);
    // the tube's asymmetry leaves a little DC on loud passages
    this.dcBlock = new Tone.Filter({ type: 'highpass', frequency: 18, Q: 0.7, rolloff: -12 });
    this.saturator = new Tone.WaveShaper(saturationCurve(t.drive), 2048);
    this.saturator.oversample = '2x';
    this.warmLow = new Tone.Filter({ type: 'lowshelf', frequency: 180, gain: w0.lowDb });
    this.warmHigh = new Tone.Filter({ type: 'highshelf', frequency: 3200, gain: w0.highDb });
    this.warmth = new Tone.Filter({ type: 'lowpass', frequency: safeCutoff(w0.lpHz, sr), Q: 0.6, rolloff: -12 });
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
      this.wow, this.flutter, this.tubeDrive, this.tube, this.tubeTrim, this.dcBlock, this.saturator,
      this.warmLow, this.warmHigh, this.warmth, this.userFilter, this.userTrim, this.lp, this.compressor, this.wearGain, this.wearLp, this.limiter, this.fade, this.volume, this.output,
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
    const w = warmthSettings(tape.warmth);
    rampParam(this.tubeDrive.gain, w.drive / TUBE_RANGE, time, rampSeconds);
    rampParam(this.tubeTrim.gain, w.trim, time, rampSeconds);
    // shelf gains are native dB (0 / negative): linear ramps, rampParam would go exponential
    this.warmLow.gain.linearRampTo(w.lowDb, Math.max(0.005, rampSeconds), time);
    this.warmHigh.gain.linearRampTo(w.highDb, Math.max(0.005, rampSeconds), time);
    rampParam(this.warmth.frequency, safeCutoff(w.lpHz, sr), time, rampSeconds);
    const wd = wearDropouts(tape.vinyl);
    // depths can be 0 / negative: linear ramps
    this.dipDepth.gain.linearRampTo(-wd.dip, Math.max(0.005, rampSeconds), time);
    this.dullDepth.gain.linearRampTo(-wd.dullHz, Math.max(0.005, rampSeconds), time);
    const d = wowDepths(tape.wow);
    rampParam(this.wow.depth, d.wow, time, rampSeconds);
    rampParam(this.flutter.depth, d.flutter, time, rampSeconds);
    const c = crushSettings(tape.crush);
    // crossfade (not a parallel blend): mixing the decimated copy with the dry one only leaves the hiss of the difference
    rampParam(this.crushWet.gain, c.wet, time, rampSeconds);
    rampParam(this.dry.gain, 1 - c.wet, time, rampSeconds);
    rampParam(this.crusher.bits, c.bits, time, rampSeconds);
    rampParam(this.crusher.hold, c.hold, time, rampSeconds);
    // keep the aliasing (that is the character), just take the fizz off the very top
    rampParam(this.crushLp.frequency, safeCutoff(logMap(1 - clamp01(tape.crush), 12000, 16000), sr), time, rampSeconds);
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
      this.wearGain, this.wearLp, this.dropouts, this.dipDepth, this.dullDepth,
      this.tubeDrive, this.tube, this.tubeTrim, this.dcBlock, this.saturator, this.warmLow, this.warmHigh, this.warmth, this.userFilter, this.userTrim, this.lp, this.compressor, this.limiter, this.fade, this.volume, this.output,
    ]) {
      n.dispose();
    }
    this.mono?.dispose();
    this.fft?.dispose();
    this.wave?.dispose();
  }
}
