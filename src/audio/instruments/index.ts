import type { LayerId, MoodId } from '@shared/index';
import { BassInstrument } from './bass';
import { DrumsInstrument } from './drums';
import type { Instrument } from './instrument';
import { KeysInstrument } from './keys';
import { MelodyInstrument } from './melody';
import { PadInstrument } from './pad';
import { TextureInstrument } from './texture';

export interface InstrumentSet {
  keys: KeysInstrument;
  pad: PadInstrument;
  bass: BassInstrument;
  melody: MelodyInstrument;
  drums: DrumsInstrument;
  texture: TextureInstrument;
}

export function createInstruments(mood: MoodId): InstrumentSet {
  return {
    keys: new KeysInstrument(mood),
    pad: new PadInstrument(mood),
    bass: new BassInstrument(mood),
    melody: new MelodyInstrument(mood),
    drums: new DrumsInstrument(mood),
    texture: new TextureInstrument(mood),
  };
}

export function allInstruments(set: InstrumentSet): Instrument[] {
  return (Object.keys(set) as LayerId[]).map((k) => set[k]);
}
