import * as Tone from 'tone';
import type { MoodId, TapeParams } from '@shared/index';
import { DEFAULT_TAPE } from '@shared/index';
import { clamp01, dbToGain } from '../mapping';
import { getPreset, type TexturePreset } from '../presets';
import { rampParam, type Instrument, type InstrumentParam } from './instrument';
import { crackleSamples, dropletSamples } from './textureBuffers';

/** User ambience control 0..1 -> linear gain. 0 is silent; otherwise floorDb .. floorDb + rangeDb. */
export function ambienceGain(v: number, floorDb: number, rangeDb: number, offsetDb = 0): number {
  const x = clamp01(v);
  return x < 0.005 ? 0 : dbToGain(floorDb + rangeDb * Math.sqrt(x) + offsetDb);
}

/**
 * Continuous ambience bed (no notes): vinyl crackle + rumble, rain (wash + droplets) and tape hiss.
 * Levels come from the user's ambience knobs scaled by the mood; the layer fader / mute still apply.
 */
export class TextureInstrument implements Instrument {
  readonly layer = 'texture' as const;
  readonly output: Tone.Gain;

  private readonly nodes: Tone.ToneAudioNode[] = [];
  private readonly crackleGain: Tone.Gain;
  private readonly rumbleGain: Tone.Gain;
  private readonly rainGain: Tone.Gain;
  private readonly dropGain: Tone.Gain;
  private readonly hissGain: Tone.Gain;
  private readonly rainBand: Tone.Filter;
  private preset: TexturePreset;
  private tape: TapeParams = { ...DEFAULT_TAPE };

  constructor(mood: MoodId) {
    const p = getPreset(mood).texture;
    this.preset = p;
    const ctx = Tone.getContext();
    const sr = ctx.sampleRate;
    this.output = new Tone.Gain(dbToGain(p.levelDb));

    const loop = (data: Float32Array): Tone.Player => {
      const buf = ctx.createBuffer(1, data.length, sr);
      buf.getChannelData(0).set(data);
      const player = new Tone.Player(new Tone.ToneAudioBuffer(buf));
      player.loop = true;
      this.nodes.push(player);
      return player;
    };
    const keep = <T extends Tone.ToneAudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };

    // vinyl: crackle loop (two offset copies panned apart) + low rumble
    this.crackleGain = keep(new Tone.Gain(0));
    const crackle = loop(crackleSamples(sr, 7, 0xc0ffee));
    const crackleB = loop(crackleSamples(sr, 5.3, 0xbeef));
    const panA = keep(new Tone.Panner(-0.35));
    const panB = keep(new Tone.Panner(0.4));
    const crackleHp = keep(new Tone.Filter({ type: 'highpass', frequency: 700, rolloff: -12 }));
    crackle.connect(panA);
    crackleB.connect(panB);
    panA.connect(crackleHp);
    panB.connect(crackleHp);
    crackleHp.chain(this.crackleGain, this.output);
    this.rumbleGain = keep(new Tone.Gain(0));
    const rumble = keep(new Tone.Noise('brown'));
    rumble.chain(keep(new Tone.Filter({ type: 'lowpass', frequency: 90, rolloff: -24 })), this.rumbleGain, this.output);

    // rain: band-passed pink noise that slowly swells + droplets
    this.rainGain = keep(new Tone.Gain(0));
    const rain = keep(new Tone.Noise('pink'));
    this.rainBand = keep(new Tone.Filter({ type: 'bandpass', frequency: p.rainHz, Q: 0.45, rolloff: -12 }));
    const rainLp = keep(new Tone.Filter({ type: 'lowpass', frequency: 6000, rolloff: -12 }));
    const swell = keep(new Tone.Tremolo({ frequency: 0.09, depth: 0.35, spread: 60 })) as Tone.Tremolo;
    swell.start();
    rain.chain(this.rainBand, rainLp, swell, this.rainGain, this.output);
    this.dropGain = keep(new Tone.Gain(0));
    const drops = loop(dropletSamples(sr, 9, 0xd209));
    const dropsPan = keep(new Tone.AutoPanner({ frequency: 0.13, depth: 0.6 })) as Tone.AutoPanner;
    dropsPan.start();
    drops.chain(keep(new Tone.Filter({ type: 'highpass', frequency: 1800, rolloff: -12 })), dropsPan, this.dropGain, this.output);

    // tape hiss
    this.hissGain = keep(new Tone.Gain(0));
    const hiss = keep(new Tone.Noise('white'));
    hiss.chain(
      keep(new Tone.Filter({ type: 'highpass', frequency: 4500, rolloff: -12 })),
      keep(new Tone.Filter({ type: 'lowpass', frequency: 11000, rolloff: -12 })),
      this.hissGain,
      this.output,
    );

    for (const src of [crackle, crackleB, drops]) src.start();
    for (const n of [rumble, rain, hiss]) (n as Tone.Noise).start();
    this.applyLevels(Tone.now(), 0);
  }

  /** User ambience controls (vinyl / rain / hiss). */
  setTape(tape: TapeParams, rampSeconds = 0.15): void {
    this.tape = { ...tape };
    this.applyLevels(Tone.now(), rampSeconds);
  }

  private applyLevels(time: number, ramp: number): void {
    const p = this.preset;
    const t = this.tape;
    rampParam(this.crackleGain.gain, ambienceGain(t.vinyl, -34, 26, p.crackleDb), time, ramp);
    rampParam(this.rumbleGain.gain, ambienceGain(t.vinyl, -40, 16, p.crackleDb), time, ramp);
    rampParam(this.rainGain.gain, ambienceGain(t.rain, -42, 30, p.rainDb), time, ramp);
    rampParam(this.dropGain.gain, ambienceGain(t.rain, -38, 26, p.rainDb), time, ramp);
    rampParam(this.hissGain.gain, ambienceGain(t.hiss, -54, 26, p.hissDb), time, ramp);
  }

  trigger(): void {
    // the ambience bed is continuous
  }

  automate(_param: InstrumentParam, _value01: number, _time: number, _rampSeconds = 0): void {
    // section-level changes use layer.gain.texture
  }

  setPreset(mood: MoodId, rampSeconds: number): void {
    const p = getPreset(mood).texture;
    this.preset = p;
    const now = Tone.now();
    rampParam(this.rainBand.frequency, p.rainHz, now, rampSeconds);
    rampParam(this.output.gain, dbToGain(p.levelDb), now, rampSeconds);
    this.applyLevels(now, rampSeconds);
  }

  releaseAll(): void {
    // continuous bed: the channel gate handles pause
  }

  getActiveVoices(): number {
    return 0;
  }

  dispose(): void {
    for (const n of this.nodes) n.dispose();
    this.output.dispose();
  }
}
