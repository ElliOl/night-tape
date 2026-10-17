import * as Tone from 'tone';
import type { MoodId } from '@shared/index';
import { dbToGain, logMap, midiToHz, saturationCurve } from '../mapping';
import { getPreset, type BassPreset } from '../presets';
import { FAST_RELEASE, rampParam, type Instrument, type InstrumentParam } from './instrument';

/** Round mono bass: triangle/sine -> gentle saturation (harmonics for small speakers) -> low-pass. */
export class BassInstrument implements Instrument {
  readonly layer = 'bass' as const;
  readonly output: Tone.Gain;

  private readonly synth: Tone.Synth;
  private readonly shaper: Tone.WaveShaper;
  private readonly filter: Tone.Filter;
  private preset: BassPreset;
  private filterPos: number;
  private automated = false;
  private busyUntil = 0;

  constructor(mood: MoodId) {
    const p = getPreset(mood).bass;
    this.preset = p;
    this.filterPos = p.filterDefault;
    this.output = new Tone.Gain(dbToGain(p.levelDb));
    this.synth = new Tone.Synth({
      oscillator: { type: p.wave },
      envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
      volume: -6,
    });
    this.shaper = new Tone.WaveShaper(saturationCurve(p.drive), 2048);
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: logMap(p.filterDefault, p.cutoffMin, p.cutoffMax), Q: p.q, rolloff: -24 });
    this.synth.chain(this.shaper, this.filter, this.output);
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    this.synth.envelope.release = this.preset.release;
    this.synth.triggerAttackRelease(midiToHz(midi), durSeconds, time, 0.35 + 0.65 * vel);
    this.busyUntil = Math.max(this.busyUntil, time + durSeconds + this.preset.release);
  }

  automate(param: InstrumentParam, value01: number, time: number, rampSeconds = 0): void {
    if (param !== 'filter') return;
    this.automated = true;
    this.filterPos = value01;
    rampParam(this.filter.frequency, logMap(value01, this.preset.cutoffMin, this.preset.cutoffMax), time, rampSeconds);
  }

  setPreset(mood: MoodId, rampSeconds: number, resetAutomation = false): void {
    const p = getPreset(mood).bass;
    const prev = this.preset;
    this.preset = p;
    const now = Tone.now();
    if (resetAutomation) this.automated = false;
    if (!this.automated) this.filterPos = p.filterDefault;
    if (p.wave !== prev.wave) this.synth.oscillator.type = p.wave;
    if (p.drive !== prev.drive) this.shaper.curve = saturationCurve(p.drive);
    this.synth.envelope.attack = p.attack;
    this.synth.envelope.decay = p.decay;
    this.synth.envelope.sustain = p.sustain;
    rampParam(this.filter.frequency, logMap(this.filterPos, p.cutoffMin, p.cutoffMax), now, rampSeconds);
    rampParam(this.filter.Q, p.q, now, rampSeconds);
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
  }

  releaseAll(time = Tone.now()): void {
    this.synth.envelope.release = FAST_RELEASE; // restored on the next trigger
    this.synth.triggerRelease(time);
    this.busyUntil = Math.min(this.busyUntil, time);
  }

  getActiveVoices(): number {
    return this.busyUntil > Tone.now() ? 1 : 0;
  }

  dispose(): void {
    this.synth.dispose();
    this.shaper.dispose();
    this.filter.dispose();
    this.output.dispose();
  }
}
