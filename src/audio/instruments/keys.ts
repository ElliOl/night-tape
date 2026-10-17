import * as Tone from 'tone';
import type { KeysPatchId, MoodId } from '@shared/index';
import { clamp01, dbToGain, logMap, midiToHz } from '../mapping';
import { KEYS_PATCHES, getPreset, withPatch, type KeysPreset } from '../presets';
import { rampParam, type Instrument, type InstrumentParam } from './instrument';

/**
 * Keys with two engines that share one effects chain:
 *  - FM: sine carrier + modulator whose index decays quickly (Rhodes, Wurlitzer, vibes, music box)
 *  - subtractive: oscillator -> resonant low-pass with its own envelope (felt piano, organ, upright, Juno, clav, guitar)
 * -> low-pass (section automation) -> stereo tremolo -> chorus.
 * Each song also gets a "colour" (0..1) that shifts brightness, tremolo and chorus, so a patch never sounds identical twice.
 */
export class KeysInstrument implements Instrument {
  readonly layer = 'keys' as const;
  readonly output: Tone.Gain;

  private readonly fm: Tone.PolySynth<Tone.FMSynth>;
  private readonly sub: Tone.PolySynth<Tone.MonoSynth>;
  private readonly filter: Tone.Filter;
  private readonly tremolo: Tone.Tremolo;
  private readonly chorus: Tone.Chorus;
  private preset: KeysPreset;
  private filterPos: number;
  private automated = false;
  private mood: MoodId;
  private patch: KeysPatchId = 'rhodes';
  private color = 0.5;
  private subWave = '';

  constructor(mood: MoodId) {
    this.mood = mood;
    const p = this.resolve();
    this.preset = p;
    this.filterPos = p.filterDefault;
    this.output = new Tone.Gain(dbToGain(p.levelDb));
    this.fm = new Tone.PolySynth(Tone.FMSynth, { ...this.fmOptions(p), volume: -2 });
    this.fm.maxPolyphony = 32;
    this.sub = new Tone.PolySynth(Tone.MonoSynth, { ...this.subOptions(p), volume: -6 });
    this.sub.maxPolyphony = 32;
    this.subWave = p.subWave;
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: this.cutoff(p), Q: 0.4, rolloff: -12 });
    this.tremolo = new Tone.Tremolo({ frequency: p.tremoloRate, depth: p.tremoloDepth, spread: 140 }).start();
    this.chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.4, wet: p.chorusWet, spread: 90 }).start();
    this.fm.connect(this.filter);
    this.sub.connect(this.filter);
    this.filter.chain(this.tremolo, this.chorus, this.output);
  }

  private fmOptions(p: KeysPreset): Partial<Tone.FMSynthOptions> {
    return {
      harmonicity: p.harmonicity,
      modulationIndex: p.modIndex,
      oscillator: { type: 'sine' },
      modulation: { type: p.modWave },
      envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
      modulationEnvelope: { attack: 0.002, decay: p.modDecay, sustain: p.modSustain, release: 0.4 },
    } as Partial<Tone.FMSynthOptions>;
  }

  private subOptions(p: KeysPreset, withWave = true): Partial<Tone.MonoSynthOptions> {
    return {
      ...(withWave ? { oscillator: { type: p.subWave, count: 3, spread: 14 } } : {}),
      filter: { type: 'lowpass', Q: p.subQ, rolloff: -24 },
      envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
      filterEnvelope: {
        attack: 0.003,
        decay: p.envDecay,
        sustain: p.envSustain,
        // the filter closes a little slower than the amp, so the tail stays warm instead of choking
        release: Math.max(0.3, p.release * 1.3),
        baseFrequency: p.envBaseHz,
        octaves: p.envOctaves,
      },
    } as Partial<Tone.MonoSynthOptions>;
  }

  /** Song colour: -0.15..+0.15 brightness around the section's filter position. */
  private cutoff(p: KeysPreset): number {
    const pos = clamp01(this.filterPos + (this.color - 0.5) * 0.3);
    return logMap(pos, p.cutoffMin, p.cutoffMax);
  }

  trigger(midi: number, durSeconds: number, time: number, vel: number): void {
    const synth = this.preset.engine === 'sub' ? this.sub : this.fm;
    synth.triggerAttackRelease(midiToHz(midi), durSeconds, time, 0.2 + 0.8 * vel);
  }

  automate(param: InstrumentParam, value01: number, time: number, rampSeconds = 0): void {
    if (param !== 'filter') return;
    this.automated = true;
    this.filterPos = value01;
    rampParam(this.filter.frequency, this.cutoff(this.preset), time, rampSeconds);
  }

  private resolve(): KeysPreset {
    return withPatch(getPreset(this.mood).keys, KEYS_PATCHES[this.patch]);
  }

  /** `color` (0..1) is the song's keys colour. */
  setPatch(patch: string, rampSeconds: number, color = 0.5, at?: number): void {
    if (!(patch in KEYS_PATCHES)) return;
    const c = Number.isFinite(color) ? clamp01(color) : 0.5;
    if (patch === this.patch && c === this.color) return;
    this.patch = patch as KeysPatchId;
    this.color = c;
    this.setPreset(this.mood, rampSeconds, false, at);
  }

  setPreset(mood: MoodId, rampSeconds: number, resetAutomation = false, at?: number): void {
    this.mood = mood;
    const p = this.resolve();
    this.preset = p;
    const now = at ?? Tone.now();
    if (resetAutomation) this.automated = false;
    if (!this.automated) this.filterPos = p.filterDefault;
    this.fm.set(this.fmOptions(p));
    // a new oscillator type re-creates the oscillators: only send it when it changed
    this.sub.set(this.subOptions(p, p.subWave !== this.subWave));
    this.subWave = p.subWave;
    // second, decorrelated colour value for the modulation effects
    const c2 = (this.color * 7.31) % 1;
    rampParam(this.filter.frequency, this.cutoff(p), now, rampSeconds);
    rampParam(this.tremolo.frequency, p.tremoloRate * (0.7 + c2 * 0.6), now, rampSeconds);
    rampParam(this.tremolo.depth, clamp01(p.tremoloDepth * (0.5 + this.color)), now, rampSeconds);
    rampParam(this.chorus.wet, clamp01(p.chorusWet + (c2 - 0.5) * 0.3), now, rampSeconds);
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
  }

  releaseAll(time = Tone.now()): void {
    this.fm.releaseAll(time);
    this.sub.releaseAll(time);
  }

  getActiveVoices(): number {
    return this.fm.activeVoices + this.sub.activeVoices;
  }

  dispose(): void {
    this.fm.dispose();
    this.sub.dispose();
    this.filter.dispose();
    this.tremolo.dispose();
    this.chorus.dispose();
    this.output.dispose();
  }
}
