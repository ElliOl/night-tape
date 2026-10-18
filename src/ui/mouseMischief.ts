/**
 * What the mouse gets up to while the cat sleeps on its level: it nibbles a layer (mutes it for a few seconds), chews
 * the tape (more wear: crackle and dropouts, for a few seconds) or just squeaks. Whatever it changes it puts back,
 * unless you changed it yourself in the meantime.
 */
import { LAYER_IDS } from '@shared/index';
import { useStore } from '../services/store';
import { SAY } from './speech';

export function mouseMischief(rand: () => number = Math.random): string {
  const st = useStore.getState();
  const r = rand();
  if (r < 0.45) {
    const layers = LAYER_IDS.filter((l) => !st.muted[l]);
    if (layers.length) {
      const layer = layers[Math.floor(rand() * layers.length)]!;
      st.setMuted(layer, true);
      setTimeout(() => {
        if (useStore.getState().muted[layer]) useStore.getState().setMuted(layer, false);
      }, 4000);
      return SAY.nibble(layer);
    }
  }
  if (r < 0.8) {
    const before = st.tape.vinyl;
    const chewed = Math.min(1, Math.round((before + 0.35) * 1000) / 1000);
    st.setTape({ vinyl: chewed });
    setTimeout(() => {
      if (useStore.getState().tape.vinyl === chewed) useStore.getState().setTape({ vinyl: before });
    }, 6000);
    return SAY.chewTape;
  }
  return SAY.squeak;
}
