import * as Tone from 'tone';
import type { KeysPatchId, MoodId } from '@shared/index';
import { dbToGain, logMap, midiToHz } from '../mapping';
import { KEYS_PATCHES, getPreset, withPatch, type KeysPreset } from '../presets';
import { rampParam, type Instrument, type InstrumentParam } from './instrument';

/**
 * FM electric piano (Rhodes-ish): sine carrier + sine modulator at 1:1 whose index decays quickly
 * (the bark of the attack) -> low-pass -> stereo tremolo -> light chorus.
 */
export class KeysInstrument implements Instrument {
  readonly layer = 'keys' as const;
  readonly output: Tone.Gain;

  private readonly poly: Tone.PolySynth<Tone.FMSynth>;
  private readonly filter: Tone.Filter;
  private readonly tremolo: Tone.Tremolo;
  private readonly chorus: Tone.Chorus;
  private preset: KeysPreset;
  private filterPos: number;
  private automated = false;
  private mood: MoodId;
  private patch: KeysPatchId = 'rhodes';

  constructor(mood: MoodId) {
    this.mood = mood;
    const p = this.resolve();
    this.preset = p;
    this.filterPos = p.filterDefault;
    this.output = new Tone.Gain(dbToGain(p.levelDb));
    this.poly = new Tone.PolySynth(Tone.FMSynth, { ...this.voiceOptions(p), volume: -2 });
    this.poly.maxPolyphony = 24;
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: logMap(p.filterDefault, p.cutoffMin, p.cutoffMax), Q: 0.4, rolloff: -12 });
    this.tremolo = new Tone.Tremolo({ frequency: p.tremoloRate, depth: p.tremoloDepth, spread: 140 }).start();
    this.chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.4, wet: p.chorusWet, spread: 90 }).start();
    this.poly.chain(this.filter, this.tremolo, this.chorus, this.output);
  }

  private voiceOptions(p: KeysPreset): Partial<Tone.FMSynthOptions> {
    return {
      harmonicity: p.harmonicity,
      modulationIndex: p.modIndex,
      oscillator: { type: 'sine' },
      modulation: { type: p.modWave },
      envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
      modulationEnvelope: { attack: 0.002, decay: p.modDecay, sustain: p.modSustain, release: 0.4 },
    } as Partial<Tone.FMSynthOptions>;
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    this.poly.triggerAttackRelease(midiToHz(midi), durSeconds, time, 0.2 + 0.8 * vel);
  }

  automate(param: InstrumentParam, value01: number, time: number, rampSeconds = 0): void {
    if (param !== 'filter') return;
    this.automated = true;
    this.filterPos = value01;
    const p = this.preset;
    rampParam(this.filter.frequency, logMap(value01, p.cutoffMin, p.cutoffMax), time, rampSeconds);
  }

  private resolve(): KeysPreset {
    return withPatch(getPreset(this.mood).keys, KEYS_PATCHES[this.patch]);
  }

  setPatch(patch: string, rampSeconds: number): void {
    if (!(patch in KEYS_PATCHES) || patch === this.patch) return;
    this.patch = patch as KeysPatchId;
    this.setPreset(this.mood, rampSeconds);
  }

  setPreset(mood: MoodId, rampSeconds: number, resetAutomation = false): void {
    this.mood = mood;
    const p = this.resolve();
    this.preset = p;
    const now = Tone.now();
    if (resetAutomation) this.automated = false;
    if (!this.automated) this.filterPos = p.filterDefault;
    this.poly.set(this.voiceOptions(p));
    rampParam(this.filter.frequency, logMap(this.filterPos, p.cutoffMin, p.cutoffMax), now, rampSeconds);
    rampParam(this.tremolo.frequency, p.tremoloRate, now, rampSeconds);
    rampParam(this.tremolo.depth, p.tremoloDepth, now, rampSeconds);
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
    this.filter.dispose();
    this.tremolo.dispose();
    this.chorus.dispose();
    this.output.dispose();
  }
}
