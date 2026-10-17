import * as Tone from 'tone';
import type { MoodId } from '@shared/index';
import { dbToGain, logMap, midiToHz } from '../mapping';
import { getPreset, type PadPreset } from '../presets';
import { rampParam, type Instrument, type InstrumentParam } from './instrument';

/** Soft detuned pad -> slowly breathing low-pass -> wide chorus. */
export class PadInstrument implements Instrument {
  readonly layer = 'pad' as const;
  readonly output: Tone.Gain;

  private readonly poly: Tone.PolySynth<Tone.Synth>;
  private readonly filter: Tone.Filter;
  private readonly lfo: Tone.LFO;
  private readonly chorus: Tone.Chorus;
  private preset: PadPreset;
  private filterPos: number;
  private automated = false;

  constructor(mood: MoodId) {
    const p = getPreset(mood).pad;
    this.preset = p;
    this.filterPos = p.filterDefault;
    this.output = new Tone.Gain(dbToGain(p.levelDb));
    this.poly = new Tone.PolySynth(Tone.Synth, { ...this.voiceOptions(p), volume: -12 });
    this.poly.maxPolyphony = 12;
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: logMap(p.filterDefault, p.cutoffMin, p.cutoffMax), Q: 0.6, rolloff: -24 });
    this.lfo = new Tone.LFO({ frequency: p.lfoRate, min: -1000, max: 1000, units: 'cents' });
    this.lfo.amplitude.value = p.lfoDepthCents / 1000;
    this.lfo.connect(this.filter.detune);
    this.lfo.start();
    this.chorus = new Tone.Chorus({ frequency: 0.3, delayTime: 6, depth: 0.7, wet: p.chorusWet, spread: 180 }).start();
    this.poly.chain(this.filter, this.chorus, this.output);
  }

  private voiceOptions(p: PadPreset): Partial<Tone.SynthOptions> {
    return {
      oscillator: { type: `fat${p.wave}`, count: 3, spread: p.spread },
      envelope: { attack: p.attack, decay: 1, sustain: 0.85, release: p.release, attackCurve: 'sine' },
    } as Partial<Tone.SynthOptions>;
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    this.poly.triggerAttackRelease(midiToHz(midi), Math.max(durSeconds, this.preset.attack), time, 0.3 + 0.7 * vel);
  }

  automate(param: InstrumentParam, value01: number, time: number, rampSeconds = 0): void {
    if (param !== 'filter') return;
    this.automated = true;
    this.filterPos = value01;
    rampParam(this.filter.frequency, logMap(value01, this.preset.cutoffMin, this.preset.cutoffMax), time, rampSeconds);
  }

  setPreset(mood: MoodId, rampSeconds: number, resetAutomation = false): void {
    const p = getPreset(mood).pad;
    const waveChanged = p.wave !== this.preset.wave;
    this.preset = p;
    const now = Tone.now();
    if (resetAutomation) this.automated = false;
    if (!this.automated) this.filterPos = p.filterDefault;
    // a new oscillator type re-creates the oscillators, so only send it when it actually changed
    this.poly.set(waveChanged ? this.voiceOptions(p) : { envelope: this.voiceOptions(p).envelope });
    rampParam(this.filter.frequency, logMap(this.filterPos, p.cutoffMin, p.cutoffMax), now, rampSeconds);
    rampParam(this.lfo.frequency, p.lfoRate, now, rampSeconds);
    rampParam(this.lfo.amplitude, p.lfoDepthCents / 1000, now, rampSeconds);
    rampParam(this.chorus.wet, p.chorusWet, now, rampSeconds);
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
  }

  releaseAll(time = Tone.now()): void {
    this.poly.releaseAll(time);
  }

  getActiveVoices(): number {
    return this.poly.activeVoices;
  }

  dispose(): void {
    this.poly.dispose();
    this.lfo.dispose();
    this.filter.dispose();
    this.chorus.dispose();
    this.output.dispose();
  }
}
