import * as Tone from 'tone';
import type { MoodId } from '@shared/index';
import { dbToGain, logMap, midiToHz } from '../mapping';
import { getPreset, type MelodyPreset } from '../presets';
import { rampParam, type Instrument, type InstrumentParam } from './instrument';

/**
 * Lead voice = blend of a soft sine "flute" and an FM bell (vibraphone / kalimba).
 * The mood sets the blend; both share a gentle vibrato and a low-pass.
 */
export class MelodyInstrument implements Instrument {
  readonly layer = 'melody' as const;
  readonly output: Tone.Gain;

  private readonly bell: Tone.PolySynth<Tone.FMSynth>;
  private readonly soft: Tone.PolySynth<Tone.Synth>;
  private readonly bellGain: Tone.Gain;
  private readonly softGain: Tone.Gain;
  private readonly vibrato: Tone.Vibrato;
  private readonly filter: Tone.Filter;
  private preset: MelodyPreset;
  private filterPos: number;
  private automated = false;

  constructor(mood: MoodId) {
    const p = getPreset(mood).melody;
    this.preset = p;
    this.filterPos = p.filterDefault;
    this.output = new Tone.Gain(dbToGain(p.levelDb));
    this.bell = new Tone.PolySynth(Tone.FMSynth, { ...this.bellOptions(p), volume: -2 });
    this.soft = new Tone.PolySynth(Tone.Synth, { ...this.softOptions(p), volume: -4 });
    this.bell.maxPolyphony = 8;
    this.soft.maxPolyphony = 8;
    this.bellGain = new Tone.Gain(p.bell);
    this.softGain = new Tone.Gain(1 - p.bell);
    this.vibrato = new Tone.Vibrato({ frequency: p.vibratoRate, depth: p.vibratoDepth, maxDelay: 0.004 });
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: logMap(p.filterDefault, p.cutoffMin, p.cutoffMax), Q: 0.5, rolloff: -12 });
    this.bell.connect(this.bellGain);
    this.soft.connect(this.softGain);
    this.bellGain.connect(this.vibrato);
    this.softGain.connect(this.vibrato);
    this.vibrato.chain(this.filter, this.output);
  }

  private bellOptions(p: MelodyPreset): Partial<Tone.FMSynthOptions> {
    return {
      harmonicity: p.bellHarmonicity,
      modulationIndex: p.bellModIndex,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: { attack: 0.003, decay: 1.4, sustain: 0.05, release: p.release },
      modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.3 },
    } as Partial<Tone.FMSynthOptions>;
  }

  private softOptions(p: MelodyPreset): Partial<Tone.SynthOptions> {
    return {
      oscillator: { type: 'fatsine', count: 2, spread: 8 },
      envelope: { attack: p.attack + 0.04, decay: 0.4, sustain: 0.6, release: p.release },
    } as Partial<Tone.SynthOptions>;
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const hz = midiToHz(midi);
    const v = 0.25 + 0.75 * vel;
    if (this.preset.bell > 0.02) this.bell.triggerAttackRelease(hz, durSeconds, time, v);
    if (this.preset.bell < 0.98) this.soft.triggerAttackRelease(hz, durSeconds, time, v);
  }

  automate(param: InstrumentParam, value01: number, time: number, rampSeconds = 0): void {
    if (param !== 'filter') return;
    this.automated = true;
    this.filterPos = value01;
    rampParam(this.filter.frequency, logMap(value01, this.preset.cutoffMin, this.preset.cutoffMax), time, rampSeconds);
  }

  setPreset(mood: MoodId, rampSeconds: number, resetAutomation = false): void {
    const p = getPreset(mood).melody;
    this.preset = p;
    const now = Tone.now();
    if (resetAutomation) this.automated = false;
    if (!this.automated) this.filterPos = p.filterDefault;
    this.bell.set(this.bellOptions(p));
    this.soft.set({ envelope: this.softOptions(p).envelope });
    rampParam(this.bellGain.gain, p.bell, now, rampSeconds);
    rampParam(this.softGain.gain, 1 - p.bell, now, rampSeconds);
    rampParam(this.vibrato.frequency, p.vibratoRate, now, rampSeconds);
    rampParam(this.vibrato.depth, p.vibratoDepth, now, rampSeconds);
    rampParam(this.filter.frequency, logMap(this.filterPos, p.cutoffMin, p.cutoffMax), now, rampSeconds);
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
  }

  releaseAll(time = Tone.now()): void {
    this.bell.releaseAll(time);
    this.soft.releaseAll(time);
  }

  getActiveVoices(): number {
    return this.bell.activeVoices + this.soft.activeVoices;
  }

  dispose(): void {
    this.bell.dispose();
    this.soft.dispose();
    this.bellGain.dispose();
    this.softGain.dispose();
    this.vibrato.dispose();
    this.filter.dispose();
    this.output.dispose();
  }
}
