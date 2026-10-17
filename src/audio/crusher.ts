import { ToneAudioWorklet, type ToneAudioWorkletOptions } from 'tone/build/esm/core/worklet/ToneAudioWorklet.js';
import { registerProcessor } from 'tone/build/esm/core/worklet/WorkletGlobalScope.js';
import 'tone/build/esm/core/worklet/ToneAudioWorkletProcessor.worklet.js';
import { Gain } from 'tone/build/esm/core/context/Gain.js';
import { Param } from 'tone/build/esm/core/context/Param.js';
import { connectSeries } from 'tone/build/esm/core/context/ToneAudioNode.js';
import { clamp01 } from './mapping';

const WORKLET_NAME = 'night-tape-crusher';

/**
 * Old-sampler decimator: sample-and-hold at sampleRate / `hold` (aliasing = the metallic, harmonic grit of an
 * SP-1200 / Mirage) followed by rounding to `bits` evenly spaced steps (the blocky, chip-tune staircase). An envelope
 * follower normalises the signal into the quantiser and scales it back afterwards, so quiet passages get the same
 * steps instead of rounding to silence.
 * Fractional `hold` uses a phase accumulator so the rate sweeps smoothly. Runs in Tone's worklet scope, so it also works inside Tone.Offline.
 */
registerProcessor(WORKLET_NAME, /* javascript */ `
  class NightTapeCrusher extends ToneAudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: 'bits', defaultValue: 16, minValue: 2, maxValue: 16, automationRate: 'k-rate' },
        { name: 'hold', defaultValue: 1, minValue: 1, maxValue: 64, automationRate: 'k-rate' },
      ];
    }
    constructor(options) {
      super(Object.assign(options, { numberOfInputs: 1, numberOfOutputs: 1 }));
      this.phase = [1, 1];
      this.held = [0, 0];
      this.env = [0, 0];
      // envelope follower: ~2 ms attack, ~120 ms release
      this.att = 1 - Math.exp(-1 / (0.002 * sampleRate));
      this.rel = 1 - Math.exp(-1 / (0.12 * sampleRate));
    }
    process(inputs, outputs, parameters) {
      const input = inputs[0];
      const output = outputs[0];
      const step = Math.pow(0.5, parameters.bits[0] - 1);
      const inc = 1 / parameters.hold[0];
      for (let ch = 0; ch < output.length; ch++) {
        const inp = input && input[ch];
        const out = output[ch];
        let phase = this.phase[ch] ?? 1;
        let held = this.held[ch] ?? 0;
        let env = this.env[ch] ?? 0;
        for (let i = 0; i < out.length; i++) {
          const x = inp ? inp[i] : 0;
          const a = Math.abs(x);
          env += (a > env ? this.att : this.rel) * (a - env);
          phase += inc;
          if (phase >= 1) {
            phase -= 1;
            // below ~-60 dB it is silence, leave it alone (no quantised hiss)
            const g = Math.max(env, 0.001);
            const y = Math.max(-1, Math.min(1, x / g));
            held = g * step * Math.round(y / step);
          }
          out[i] = held;
        }
        this.phase[ch] = phase;
        this.held[ch] = held;
        this.env[ch] = env;
      }
      return !this.disposed;
    }
  }
`);

/** crush 0..1 -> decimator settings. Mild at the bottom of the knob, ~5 kHz / 3-bit chip-tune crunch at the top. */
export function crushSettings(crush: number): { bits: number; hold: number; wet: number } {
  const c = clamp01(crush);
  return {
    bits: 16 - 13 * Math.pow(c, 0.7),
    hold: 1 + 8 * Math.pow(c, 1.4),
    wet: Math.min(1, c * 3),
  };
}

interface CrusherOptions extends ToneAudioWorkletOptions {
  bits: number;
  hold: number;
}

/** Tone node wrapping the decimator worklet: `input` -> worklet -> `output`, with `bits` / `hold` params. */
export class Crusher extends ToneAudioWorklet<CrusherOptions> {
  readonly name: string = 'NightTapeCrusher';
  readonly input: Gain;
  readonly output: Gain;
  readonly bits: Param<'positive'>;
  readonly hold: Param<'positive'>;

  constructor(opts: Partial<CrusherOptions> = {}) {
    const options = { ...Crusher.getDefaults(), ...opts };
    super(options);
    this.input = new Gain({ context: this.context });
    this.output = new Gain({ context: this.context });
    this.bits = new Param({ context: this.context, value: options.bits, units: 'positive', minValue: 2, maxValue: 16, param: this._dummyParam, swappable: true });
    this.hold = new Param({ context: this.context, value: options.hold, units: 'positive', minValue: 1, maxValue: 64, param: this._dummyParam, swappable: true });
  }

  static getDefaults(): CrusherOptions {
    return Object.assign(ToneAudioWorklet.getDefaults(), { bits: 16, hold: 1 });
  }

  protected _audioWorkletName(): string {
    return WORKLET_NAME;
  }

  protected onReady(node: AudioWorkletNode): void {
    connectSeries(this.input, node, this.output);
    this.bits.setParam(node.parameters.get('bits')!);
    this.hold.setParam(node.parameters.get('hold')!);
  }

  dispose(): this {
    super.dispose();
    this.input.dispose();
    this.output.dispose();
    this.bits.dispose();
    this.hold.dispose();
    return this;
  }
}
