import * as Tone from 'tone';
import type { MoodId, TapeParams } from '@shared/index';
import { DEFAULT_TAPE } from '@shared/index';
import { clamp01, dbToGain, safeCutoff } from '../mapping';
import { getPreset, type TexturePreset } from '../presets';
import { rampParam, type Instrument, type InstrumentParam } from './instrument';
import { crackleSamples, dropletSamples } from './textureBuffers';

/** User ambience control 0..1 -> linear gain. 0 is silent; otherwise floorDb .. floorDb + rangeDb. */
export function ambienceGain(v: number, floorDb: number, rangeDb: number, offsetDb = 0): number {
  const x = clamp01(v);
  return x < 0.005 ? 0 : dbToGain(floorDb + rangeDb * Math.sqrt(x) + offsetDb);
}

/**
 * hiss knob 0..1 -> tone of the hiss: low = a soft tape hiss around 4-9 kHz, top = a thin, high, steamy hiss up to
 * 16 kHz with a soft, airy steam band near 9-11 kHz.
 */
export function hissTone(hiss: number): { hpHz: number; lpHz: number; steamHz: number; steam: number } {
  const h = clamp01(hiss);
  return {
    hpHz: 3500 * Math.pow(9500 / 3500, h * h),
    lpHz: 9000 * Math.pow(16000 / 9000, h),
    steamHz: 8500 + 2500 * h,
    steam: fadeIn(h, 0.55, 1),
  };
}

/** 0 below `a`, 1 above `b`, smooth in between. */
function fadeIn(x: number, a: number, b: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * rain knob 0..1 -> gain of each rain layer. Low: a few slow, fat drops on the window. Middle: steady rain (more
 * drops, a soft wash). Top: a downpour (dense patter, loud broad wash, low roar).
 */
export function rainLayers(rain: number): { sparse: number; steady: number; dense: number; wash: number; roar: number } {
  const r = clamp01(rain);
  if (r < 0.005) return { sparse: 0, steady: 0, dense: 0, wash: 0, roar: 0 };
  return {
    sparse: dbToGain(-26 + 12 * Math.sqrt(r)) * (1 - 0.5 * fadeIn(r, 0.6, 1)),
    steady: dbToGain(-14) * fadeIn(r, 0.2, 0.55),
    dense: dbToGain(-12) * fadeIn(r, 0.5, 0.9),
    wash: dbToGain(-46 + 50 * Math.pow(r, 1.4)) * fadeIn(r, 0.08, 0.35),
    roar: dbToGain(-4) * fadeIn(r, 0.7, 1),
  };
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
  private readonly sparseGain: Tone.Gain;
  private readonly steadyGain: Tone.Gain;
  private readonly denseGain: Tone.Gain;
  private readonly roarGain: Tone.Gain;
  private readonly rainLp: Tone.Filter;
  private readonly hissGain: Tone.Gain;
  private readonly hissHp: Tone.Filter;
  private readonly hissLp: Tone.Filter;
  private readonly steamGain: Tone.Gain;
  private readonly steamBand: Tone.Filter;
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

    // wear: dust crackle loop (two offset copies panned apart) + low rumble. Tape dropouts live on the master.
    this.crackleGain = keep(new Tone.Gain(0));
    const crackle = loop(crackleSamples(sr, 7, 0xc0ffee, 26));
    const crackleB = loop(crackleSamples(sr, 5.3, 0xbeef, 18));
    const panA = keep(new Tone.Panner(-0.35));
    const panB = keep(new Tone.Panner(0.4));
    const crackleHp = keep(new Tone.Filter({ type: 'highpass', frequency: 300, rolloff: -12 }));
    crackle.connect(panA);
    crackleB.connect(panB);
    panA.connect(crackleHp);
    panB.connect(crackleHp);
    crackleHp.chain(this.crackleGain, this.output);
    this.rumbleGain = keep(new Tone.Gain(0));
    const rumble = keep(new Tone.Noise('brown'));
    rumble.chain(keep(new Tone.Filter({ type: 'lowpass', frequency: 90, rolloff: -24 })), this.rumbleGain, this.output);

    // rain wash: band-passed pink noise that slowly swells; opens up (wider, brighter) into a downpour
    this.rainGain = keep(new Tone.Gain(0));
    const rain = keep(new Tone.Noise('pink'));
    this.rainBand = keep(new Tone.Filter({ type: 'bandpass', frequency: p.rainHz, Q: 0.45, rolloff: -12 }));
    this.rainLp = keep(new Tone.Filter({ type: 'lowpass', frequency: 6000, rolloff: -12 }));
    const swell = keep(new Tone.Tremolo({ frequency: 0.09, depth: 0.35, spread: 60 })) as Tone.Tremolo;
    swell.start();
    rain.chain(this.rainBand, this.rainLp, swell, this.rainGain, this.output);
    // downpour roar: low, heavy rumble of rain on roofs and street
    this.roarGain = keep(new Tone.Gain(0));
    const roar = keep(new Tone.Noise('brown'));
    roar.chain(
      keep(new Tone.Filter({ type: 'bandpass', frequency: 260, Q: 0.6, rolloff: -12 })),
      keep(new Tone.Tremolo({ frequency: 0.06, depth: 0.3, spread: 90 }).start()),
      this.roarGain,
      this.output,
    );
    // drops on the glass, three densities: slow fat drops / steady rain / dense patter
    const dropLayer = (data: Float32Array, hpHz: number, panHz: number): Tone.Gain => {
      const g = keep(new Tone.Gain(0));
      const pan = keep(new Tone.AutoPanner({ frequency: panHz, depth: 0.6 })) as Tone.AutoPanner;
      pan.start();
      loop(data).chain(keep(new Tone.Filter({ type: 'highpass', frequency: hpHz, rolloff: -12 })), pan, g, this.output);
      return g;
    };
    this.sparseGain = dropLayer(dropletSamples(sr, 11, 0xd201, { rate: 2.2, loHz: 900, hiHz: 2600, minLen: 0.02, maxLen: 0.05 }), 500, 0.07);
    this.steadyGain = dropLayer(dropletSamples(sr, 9, 0xd209), 1800, 0.13);
    this.denseGain = dropLayer(dropletSamples(sr, 7.3, 0xd2a7, { rate: 70, loHz: 2500, hiHz: 7500, minLen: 0.003, maxLen: 0.012 }), 2500, 0.21);

    // tape hiss: its band climbs with the knob, and near the top a soft airy steam band comes in
    this.hissGain = keep(new Tone.Gain(0));
    const hiss = keep(new Tone.Noise('white'));
    const h0 = hissTone(DEFAULT_TAPE.hiss);
    this.hissHp = keep(new Tone.Filter({ type: 'highpass', frequency: h0.hpHz, rolloff: -12 }));
    this.hissLp = keep(new Tone.Filter({ type: 'lowpass', frequency: h0.lpHz, rolloff: -12 }));
    hiss.chain(this.hissHp, this.hissLp, this.hissGain, this.output);
    this.steamGain = keep(new Tone.Gain(0));
    this.steamBand = keep(new Tone.Filter({ type: 'bandpass', frequency: h0.steamHz, Q: 1.8, rolloff: -12 }));
    // the whistle wavers a little, like steam escaping in puffs
    const puff = keep(new Tone.Tremolo({ frequency: 0.5, depth: 0.25, spread: 40 }).start());
    hiss.chain(this.steamBand, puff, this.steamGain, this.output);

    for (const n of this.nodes) if (n instanceof Tone.Player) n.start();
    for (const n of [rumble, rain, roar, hiss]) (n as Tone.Noise).start();
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
    // ranges are wide on purpose: the top of each knob is a downpour / a chewed-up tape
    rampParam(this.crackleGain.gain, ambienceGain(t.vinyl, -34, 37, p.crackleDb), time, ramp);
    rampParam(this.rumbleGain.gain, ambienceGain(t.vinyl, -46, 36, p.crackleDb), time, ramp);
    const r = rainLayers(t.rain);
    const rainOff = dbToGain(p.rainDb);
    rampParam(this.rainGain.gain, r.wash * rainOff, time, ramp);
    rampParam(this.sparseGain.gain, r.sparse * rainOff, time, ramp);
    rampParam(this.steadyGain.gain, r.steady * rainOff, time, ramp);
    rampParam(this.denseGain.gain, r.dense * rainOff, time, ramp);
    rampParam(this.roarGain.gain, r.roar * rainOff, time, ramp);
    // a downpour is broad and bright, a drizzle is soft
    rampParam(this.rainLp.frequency, 3500 + 7000 * clamp01(t.rain), time, ramp);
    // kept light: at the top it is a soft wisp of steam, not a wall of noise driving the tape
    const hissDb = ambienceGain(t.hiss, -52, 24, p.hissDb);
    rampParam(this.hissGain.gain, hissDb, time, ramp);
    const ht = hissTone(t.hiss);
    rampParam(this.hissHp.frequency, ht.hpHz, time, ramp);
    rampParam(this.hissLp.frequency, safeCutoff(ht.lpHz, Tone.getContext().sampleRate), time, ramp);
    rampParam(this.steamBand.frequency, ht.steamHz, time, ramp);
    // a gentle airy lift near the top, just above the hiss
    rampParam(this.steamGain.gain, hissDb * dbToGain(3) * ht.steam, time, ramp);
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
