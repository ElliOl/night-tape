import * as Tone from 'tone';
import { DRUM, type MoodId } from '@shared/index';
import { dbToGain, safeCutoff, saturationCurve } from '../mapping';
import { getPreset, type DrumPreset } from '../presets';
import { rampParam, type Instrument, type InstrumentParam } from './instrument';

/**
 * Dusty synthesized kit: soft round kick, pink-noise snare with a tonal body, rim click, hats and shaker.
 * Everything is summed, lightly saturated and pushed through a low "ceiling" filter so it sits behind the keys
 * like a sampled break played off a worn record.
 */
export class DrumsInstrument implements Instrument {
  readonly layer = 'drums' as const;
  readonly output: Tone.Gain;

  private readonly bus: Tone.Gain;
  private readonly shaper: Tone.WaveShaper;
  private readonly ceiling: Tone.Filter;
  private readonly kick: Tone.MembraneSynth;
  private readonly snare: Tone.NoiseSynth;
  private readonly snareBody: Tone.MembraneSynth;
  private readonly rim: Tone.MembraneSynth;
  private readonly rimClick: Tone.NoiseSynth;
  private readonly hat: Tone.NoiseSynth;
  private readonly openHat: Tone.NoiseSynth;
  private readonly shaker: Tone.NoiseSynth;
  private readonly filters: Tone.Filter[] = [];
  private preset: DrumPreset;
  private busyUntil = 0;

  constructor(mood: MoodId) {
    const p = getPreset(mood).drums;
    this.preset = p;
    this.output = new Tone.Gain(dbToGain(p.levelDb));
    this.bus = new Tone.Gain(1);
    this.shaper = new Tone.WaveShaper(saturationCurve(p.drive), 2048);
    this.ceiling = new Tone.Filter({ type: 'lowpass', frequency: p.ceilingHz, Q: 0.5, rolloff: -12 });
    this.bus.chain(this.shaper, this.ceiling, this.output);

    const filter = (type: BiquadFilterType, freq: number, q = 0.7): Tone.Filter => {
      const f = new Tone.Filter({ type, frequency: freq, Q: q, rolloff: -12 });
      this.filters.push(f);
      return f;
    };

    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.045,
      octaves: p.kickPitchOct,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.003, decay: p.kickDecay, sustain: 0, release: 0.08 },
      volume: p.kickDb,
    }).connect(this.bus);

    this.snare = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.002, decay: p.snareDecay, sustain: 0, release: 0.05 },
      volume: p.snareDb,
    }).chain(filter('highpass', 600), filter('peaking', 1900, 1.2), this.bus);
    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.015,
      octaves: 0.8,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.03 },
      volume: p.snareDb - 4,
    }).connect(this.bus);

    this.rim = new Tone.MembraneSynth({
      pitchDecay: 0.004,
      octaves: 1,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.02 },
      volume: p.rimDb,
    }).chain(filter('highpass', 300), this.bus);
    this.rimClick = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.0005, decay: 0.012, sustain: 0, release: 0.01 },
      volume: p.rimDb - 6,
    }).chain(filter('bandpass', 3200, 1.5), this.bus);

    this.hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: p.hatDecay, sustain: 0, release: 0.02 },
      volume: p.hatDb,
    }).chain(filter('highpass', 6500, 0.5), this.bus);
    this.openHat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.002, decay: p.openHatDecay, sustain: 0, release: 0.08 },
      volume: p.hatDb - 2,
    }).chain(filter('highpass', 6000, 0.5), this.bus);
    this.shaker = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.012, decay: 0.06, sustain: 0, release: 0.03 },
      volume: p.shakerDb,
    }).chain(filter('bandpass', 5200, 1.1), this.bus);
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const p = this.preset;
    const v = Math.max(0.05, Math.min(1, 0.2 + 0.8 * vel));
    this.busyUntil = Math.max(this.busyUntil, time + 0.4);
    switch (midi) {
      case DRUM.kick:
        this.kick.triggerAttackRelease(p.kickHz, p.kickDecay, time, v);
        break;
      case DRUM.snare:
        this.snare.triggerAttackRelease(p.snareDecay, time, v);
        this.snareBody.triggerAttackRelease(p.snareToneHz, 0.08, time, v);
        break;
      case DRUM.rim:
        this.rim.triggerAttackRelease(820, 0.03, time, v);
        this.rimClick.triggerAttackRelease(0.012, time, v);
        break;
      case DRUM.hatClosed:
        this.openHat.triggerRelease(time); // choke
        this.hat.triggerAttackRelease(p.hatDecay, time, v);
        break;
      case DRUM.hatOpen:
        this.openHat.triggerAttackRelease(p.openHatDecay, time, v);
        break;
      case DRUM.shaker:
        this.shaker.triggerAttackRelease(0.05, time, v);
        break;
      default:
        break;
    }
    void durSeconds;
  }

  automate(_param: InstrumentParam, _value01: number, _time: number, _rampSeconds = 0): void {
    // drums have no automation target
  }

  setPreset(mood: MoodId, rampSeconds: number): void {
    const p = getPreset(mood).drums;
    const prev = this.preset;
    this.preset = p;
    const now = Tone.now();
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
    rampParam(this.ceiling.frequency, safeCutoff(p.ceilingHz), now, rampSeconds);
    rampParam(this.kick.volume, p.kickDb, now, rampSeconds);
    rampParam(this.snare.volume, p.snareDb, now, rampSeconds);
    rampParam(this.snareBody.volume, p.snareDb - 4, now, rampSeconds);
    rampParam(this.rim.volume, p.rimDb, now, rampSeconds);
    rampParam(this.rimClick.volume, p.rimDb - 6, now, rampSeconds);
    rampParam(this.hat.volume, p.hatDb, now, rampSeconds);
    rampParam(this.openHat.volume, p.hatDb - 2, now, rampSeconds);
    rampParam(this.shaker.volume, p.shakerDb, now, rampSeconds);
    if (p.drive !== prev.drive) this.shaper.curve = saturationCurve(p.drive);
    // per-hit shape: only affects the next hit
    this.kick.octaves = p.kickPitchOct;
    this.kick.envelope.decay = p.kickDecay;
    this.snare.envelope.decay = p.snareDecay;
    this.hat.envelope.decay = p.hatDecay;
    this.openHat.envelope.decay = p.openHatDecay;
  }

  releaseAll(time = Tone.now()): void {
    this.openHat.triggerRelease(time);
    this.kick.triggerRelease(time);
    this.busyUntil = Math.min(this.busyUntil, time);
  }

  getActiveVoices(): number {
    return this.busyUntil > Tone.now() ? 1 : 0;
  }

  dispose(): void {
    for (const n of [this.kick, this.snare, this.snareBody, this.rim, this.rimClick, this.hat, this.openHat, this.shaker]) n.dispose();
    for (const f of this.filters) f.dispose();
    this.bus.dispose();
    this.shaper.dispose();
    this.ceiling.dispose();
    this.output.dispose();
  }
}
