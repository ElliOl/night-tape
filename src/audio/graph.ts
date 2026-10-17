import * as Tone from 'tone';
import {
  DEFAULT_TAPE, LAYER_IDS, type AutomationTarget, type FilterMode, type LayerId, type MixerParams, type MoodId, type SoundPalette, type TapeParams,
} from '@shared/index';
import { FxBus, spaceDelaySend } from './fx';
import { allInstruments, createInstruments, type InstrumentSet } from './instruments';
import { TapeMaster } from './master';
import { SEND_NEUTRAL, parseTarget, sendMultiplier } from './mapping';
import { ChannelStrip } from './mixer';
import { MOOD_RAMP_SECONDS, getPreset } from './presets';

export interface GraphOptions {
  mood: MoodId;
  mixer: MixerParams;
  tape?: TapeParams;
  /** create FFT/level analysers (false for offline rendering) */
  analysis?: boolean;
  /** connect the master to the destination of the CURRENT context (default true) */
  toDestination?: boolean;
  muted?: Iterable<LayerId>;
}

/**
 * The complete audio graph: instruments -> channel strips -> (dry master input | fx sends) -> tape master.
 * Built against `Tone.getContext()` at construction time, so it also works inside `Tone.Offline`.
 */
export class AudioGraph {
  readonly instruments: InstrumentSet;
  readonly strips: Record<LayerId, ChannelStrip>;
  readonly fx: FxBus;
  readonly master: TapeMaster;

  private mood: MoodId;
  private reverbMul = SEND_NEUTRAL;
  private space = DEFAULT_TAPE.space;
  private disposed = false;

  constructor(opts: GraphOptions) {
    this.mood = opts.mood;
    this.master = new TapeMaster(opts.mood, { analysis: opts.analysis, toDestination: opts.toDestination, volume: opts.mixer.master });
    this.fx = new FxBus(opts.mood);
    this.fx.output.connect(this.master.input);
    this.instruments = createInstruments(opts.mood);
    const strips = {} as Record<LayerId, ChannelStrip>;
    for (const inst of allInstruments(this.instruments)) {
      strips[inst.layer] = new ChannelStrip(inst.layer, inst, this.master.input, this.fx.reverbIn, this.fx.delayIn, opts.mixer[inst.layer]);
    }
    this.strips = strips;
    this.setTape(opts.tape ?? DEFAULT_TAPE, 0);
    this.applySends(Tone.now(), 0);
    const muted = new Set(opts.muted ?? []);
    for (const l of LAYER_IDS) this.strips[l].setAudible(!muted.has(l), Tone.now(), 0);
  }

  setMixer(mixer: MixerParams, immediate = false): void {
    const now = Tone.now();
    const ramp = immediate ? 0.01 : 0.05;
    for (const l of LAYER_IDS) this.strips[l].setFader(mixer[l] ?? 0.7, now, ramp);
    this.master.setVolume(mixer.master ?? 0.8, now, ramp);
  }

  setTape(tape: TapeParams, rampSeconds = 0.12): void {
    this.master.setTape(tape, Tone.now(), rampSeconds);
    this.fx.setSpace(tape.space, rampSeconds);
    this.instruments.texture.setTape(tape, rampSeconds);
    if (tape.space !== this.space) {
      this.space = tape.space;
      this.applySends(Tone.now(), rampSeconds);
    }
  }

  setFilterMode(mode: FilterMode): void {
    this.master.setFilterMode(mode);
  }

  /** A new song: every instrument moves to its patch (glides while the song transition has the master filter closed). */
  applyPalette(palette: SoundPalette, rampSeconds = 1.2, time?: number): void {
    for (const l of ['pad', 'bass', 'melody'] as const) this.instruments[l].setPatch?.(palette[l], rampSeconds, undefined, time);
    this.instruments.keys.setPatch(palette.keys, rampSeconds, palette.keysColor ?? 0.5, time);
    this.instruments.drums.setPatch(palette.drums, rampSeconds, palette.drumTune ?? 0, time);
  }

  setLayerMuted(layer: LayerId, muted: boolean, time = Tone.now()): void {
    this.strips[layer].setAudible(!muted, time, 0.03);
  }

  setMood(mood: MoodId, rampSeconds = MOOD_RAMP_SECONDS): void {
    this.mood = mood;
    for (const inst of allInstruments(this.instruments)) inst.setPreset(mood, rampSeconds);
    this.fx.setMood(mood, rampSeconds);
    this.master.setMood(mood, rampSeconds);
    this.applySends(Tone.now(), rampSeconds);
  }

  private applySends(time: number, rampSeconds: number): void {
    const fx = getPreset(this.mood).fx;
    for (const l of LAYER_IDS) {
      this.strips[l].setSends(fx.reverbSend[l] * this.reverbMul, spaceDelaySend(fx.delaySend[l], l, this.space), time, rampSeconds);
    }
  }

  trigger(layer: LayerId, midi: number, durSeconds: number, time: number, vel: number): void {
    this.instruments[layer]?.trigger(midi, durSeconds, time, vel);
  }

  automate(target: AutomationTarget, value01: number, time: number, rampSeconds: number): void {
    const t = parseTarget(target);
    switch (t.kind) {
      case 'filter':
        this.instruments[t.layer].automate('filter', value01, time, rampSeconds);
        break;
      case 'layerGain':
        this.strips[t.layer].setAutomationGain(value01, time, rampSeconds);
        break;
      case 'sendReverb':
        this.reverbMul = sendMultiplier(value01);
        this.applySends(time, rampSeconds);
        break;
      case 'masterFilter':
        this.master.setFilter(value01, time, rampSeconds);
        break;
      default:
        break;
    }
  }

  setTempo(bpm: number, time: number, rampSeconds: number): void {
    this.fx.setTempo(bpm, time, Math.max(0.3, rampSeconds));
  }

  /** Pause gate: closes/opens every strip (sends included) so reverb/delay tails ring out naturally. */
  setPlayGate(open: boolean, time = Tone.now(), rampSeconds = 0.08): void {
    for (const l of LAYER_IDS) this.strips[l].setGate(open, time, rampSeconds);
  }

  releaseAll(time = Tone.now()): void {
    for (const inst of allInstruments(this.instruments)) inst.releaseAll(time);
  }

  /** Back to neutral automation state (call while the master is silent). */
  resetAutomationState(): void {
    const now = Tone.now();
    this.reverbMul = SEND_NEUTRAL;
    for (const inst of allInstruments(this.instruments)) inst.setPreset(this.mood, 0.05, true);
    this.fx.setMood(this.mood, 0.05);
    this.applySends(now, 0.05);
    for (const l of LAYER_IDS) this.strips[l].resetAutomation(now);
    this.master.setFilter(1, now, 0.05);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const l of LAYER_IDS) this.strips[l].dispose();
    for (const inst of allInstruments(this.instruments)) inst.dispose();
    this.fx.dispose();
    this.master.dispose();
  }
}
