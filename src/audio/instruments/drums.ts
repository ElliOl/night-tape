import * as Tone from 'tone';
import { DRUM, type KitId, type MoodId } from '@shared/index';
import { dbToGain, safeCutoff, saturationCurve } from '../mapping';
import { KITS, getPreset, withPatch, type DrumPreset } from '../presets';
import { rampParam, type Instrument, type InstrumentParam } from './instrument';

/**
 * Synthesized kit: kick, noise snare with a tonal body, clap, rim click, hats, ride and shaker. Everything is summed,
 * saturated and pushed through a low "ceiling" filter so it sits behind the keys like a sampled break. Each song picks
 * a kit (dusty, brushes, tight, crunchy, jazz, soft) that retunes all of it.
 */
export class DrumsInstrument implements Instrument {
  readonly layer = 'drums' as const;
  readonly output: Tone.Gain;

  private readonly bus: Tone.Gain;
  private readonly shaper: Tone.WaveShaper;
  private readonly ceiling: Tone.Filter;
  private readonly kick: Tone.MembraneSynth;
  private readonly snare: Tone.NoiseSynth;
  private readonly snareBand: Tone.Filter;
  private readonly snareBody: Tone.MembraneSynth;
  private readonly clap: Tone.NoiseSynth;
  private readonly rim: Tone.MembraneSynth;
  private readonly rimClick: Tone.NoiseSynth;
  private readonly hat: Tone.NoiseSynth;
  private readonly hatHp: Tone.Filter;
  private readonly openHat: Tone.NoiseSynth;
  private readonly openHp: Tone.Filter;
  private readonly ride: Tone.MetalSynth;
  private readonly shaker: Tone.NoiseSynth;
  private readonly filters: Tone.Filter[] = [];
  private preset: DrumPreset;
  private mood: MoodId;
  private kit: KitId = 'dusty';
  private busyUntil = 0;

  constructor(mood: MoodId) {
    this.mood = mood;
    const p = this.resolve();
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

    this.snareBand = filter('peaking', p.snareHz, 1.2);
    this.snare = new Tone.NoiseSynth({
      noise: { type: p.snareNoise },
      envelope: { attack: 0.002, decay: p.snareDecay, sustain: 0, release: 0.05 },
      volume: p.snareDb,
    }).chain(filter('highpass', 600), this.snareBand, this.bus);
    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.015,
      octaves: 0.8,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.03 },
      volume: p.snareDb - 4,
    }).connect(this.bus);

    this.clap = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.04 },
      volume: p.clapDb,
    }).chain(filter('bandpass', 1400, 0.9), this.bus);

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

    this.hatHp = filter('highpass', p.hatHpHz, 0.5);
    this.hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: p.hatDecay, sustain: 0, release: 0.02 },
      volume: p.hatDb,
    }).chain(this.hatHp, this.bus);
    this.openHp = filter('highpass', p.hatHpHz - 500, 0.5);
    this.openHat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.002, decay: p.openHatDecay, sustain: 0, release: 0.08 },
      volume: p.hatDb - 2,
    }).chain(this.openHp, this.bus);

    this.ride = new Tone.MetalSynth({
      envelope: { attack: 0.002, decay: 1.1, release: 0.3 },
      harmonicity: 5.1,
      modulationIndex: 28,
      resonance: 4800,
      octaves: 1.2,
      volume: p.rideDb,
    });
    this.ride.frequency.value = 340;
    this.ride.chain(filter('highpass', 2500, 0.5), this.bus);

    this.shaker = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.012, decay: 0.06, sustain: 0, release: 0.03 },
      volume: p.shakerDb,
    }).chain(filter('bandpass', 5200, 1.1), this.bus);
  }

  private resolve(): DrumPreset {
    return withPatch(getPreset(this.mood).drums, KITS[this.kit]);
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const p = this.preset;
    const v = Math.max(0.05, Math.min(1, 0.15 + 0.85 * vel));
    this.busyUntil = Math.max(this.busyUntil, time + 0.4);
    switch (midi) {
      case DRUM.kick:
        this.kick.triggerAttackRelease(p.kickHz, p.kickDecay, time, v);
        break;
      case DRUM.snare:
        this.snare.triggerAttackRelease(p.snareDecay, time, v);
        this.snareBody.triggerAttackRelease(p.snareToneHz, 0.08, time, v);
        break;
      case DRUM.clap:
        for (let i = 0; i < 3; i++) this.clap.triggerAttackRelease(0.01, time + i * 0.01, v * (0.5 + 0.15 * i));
        this.clap.triggerAttackRelease(0.11, time + 0.03, v);
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
      case DRUM.ride:
        this.ride.triggerAttackRelease(0.9, time, v * 0.8);
        this.busyUntil = Math.max(this.busyUntil, time + 1.2);
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

  setPatch(patch: string, rampSeconds: number): void {
    if (!(patch in KITS) || patch === this.kit) return;
    this.kit = patch as KitId;
    this.setPreset(this.mood, rampSeconds);
  }

  setPreset(mood: MoodId, rampSeconds: number): void {
    this.mood = mood;
    const p = this.resolve();
    const prev = this.preset;
    this.preset = p;
    const now = Tone.now();
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
    rampParam(this.ceiling.frequency, safeCutoff(p.ceilingHz), now, rampSeconds);
    rampParam(this.kick.volume, p.kickDb, now, rampSeconds);
    rampParam(this.snare.volume, p.snareDb, now, rampSeconds);
    rampParam(this.snareBody.volume, p.snareDb - 4, now, rampSeconds);
    rampParam(this.snareBand.frequency, p.snareHz, now, rampSeconds);
    rampParam(this.clap.volume, p.clapDb, now, rampSeconds);
    rampParam(this.rim.volume, p.rimDb, now, rampSeconds);
    rampParam(this.rimClick.volume, p.rimDb - 6, now, rampSeconds);
    rampParam(this.hat.volume, p.hatDb, now, rampSeconds);
    rampParam(this.openHat.volume, p.hatDb - 2, now, rampSeconds);
    rampParam(this.hatHp.frequency, safeCutoff(p.hatHpHz), now, rampSeconds);
    rampParam(this.openHp.frequency, safeCutoff(p.hatHpHz - 500), now, rampSeconds);
    rampParam(this.ride.volume, p.rideDb, now, rampSeconds);
    rampParam(this.shaker.volume, p.shakerDb, now, rampSeconds);
    if (p.drive !== prev.drive) this.shaper.curve = saturationCurve(p.drive);
    // per-hit shape: only affects the next hit
    if (p.snareNoise !== prev.snareNoise) this.snare.noise.type = p.snareNoise;
    this.kick.octaves = p.kickPitchOct;
    this.kick.envelope.decay = p.kickDecay;
    this.snare.envelope.decay = p.snareDecay;
    this.hat.envelope.decay = p.hatDecay;
    this.openHat.envelope.decay = p.openHatDecay;
  }

  releaseAll(time = Tone.now()): void {
    this.openHat.triggerRelease(time);
    this.ride.triggerRelease(time);
    this.kick.triggerRelease(time);
    this.busyUntil = Math.min(this.busyUntil, time);
  }

  getActiveVoices(): number {
    return this.busyUntil > Tone.now() ? 1 : 0;
  }

  dispose(): void {
    for (const n of [
      this.kick, this.snare, this.snareBody, this.clap, this.rim, this.rimClick, this.hat, this.openHat, this.ride, this.shaker,
    ]) {
      n.dispose();
    }
    for (const f of this.filters) f.dispose();
    this.bus.dispose();
    this.shaper.dispose();
    this.ceiling.dispose();
    this.output.dispose();
  }
}
