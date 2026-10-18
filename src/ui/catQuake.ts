/**
 * When the controlled cat lands hard on a level of the page, the level shakes, and there is a chance the music changes.
 * What changes depends on the level it shook: the window or the tape deck gets a new tape, the station panel switches
 * station, the groove / tape / filter / mixer panels get their knobs and faders knocked off a bit.
 */
import { LAYER_IDS, MOOD_IDS, type GenerationParams, type TapeParams } from '@shared/index';
import { SAY } from './speech';
import { useStore } from '../services/store';
import { nextTape } from './uiState';

/** landing speed (px/s) from which a landing counts as a shake */
export const QUAKE_FROM = 950;
const QUAKE_FULL = 2200;

/** 0..1 strength of a landing at `vy` px/s (0 = no shake). */
export const quakeStrength = (vy: number): number => Math.max(0, Math.min(1, (vy - QUAKE_FROM) / (QUAKE_FULL - QUAKE_FROM)));

/** Chance the music changes for a shake of `strength`: 15% for a bump, up to 50% for a big drop. */
export const quakeChance = (strength: number): number => (strength <= 0 ? 0 : 0.15 + 0.35 * strength);

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const jolt = (v: number, amount: number): number => Math.round(clamp01(v + (Math.random() * 2 - 1) * amount) * 1000) / 1000;

function shake(el: Element, strength: number): void {
  const h = el as HTMLElement;
  h.style.setProperty('--quake', `${(1.5 + 4 * strength).toFixed(1)}px`);
  h.classList.remove('cat-quake');
  void h.offsetWidth; // restart the animation
  h.classList.add('cat-quake');
  setTimeout(() => h.classList.remove('cat-quake'), 520);
}

/**
 * The cat landed on `platform` at `vy` px/s. Shakes its level and maybe changes the music.
 * Returns a word for the cat's speech bubble when the music changed.
 */
export function catLanded(platform: Element, vy: number, rand: () => number = Math.random, mayChangeMusic = true): string | null {
  const strength = quakeStrength(vy);
  if (strength <= 0) return null;
  const level = platform.closest('.panel, .hero');
  if (!level) return null;
  shake(level, strength);
  // only a landing the player steered can change the music (not the cat roaming on its own)
  if (!mayChangeMusic || rand() >= quakeChance(strength)) return null;

  const st = useStore.getState();
  const cls = level.classList;
  if (cls.contains('panel--station')) {
    const others = MOOD_IDS.filter((m) => m !== st.params.mood);
    const mood = others[Math.floor(rand() * others.length)]!;
    st.setParams({ mood });
    return SAY.station(mood);
  }
  if (cls.contains('panel--groove')) {
    const keys = ['energy', 'complexity', 'variation', 'swing'] as const;
    st.setParams(Object.fromEntries(keys.map((k) => [k, jolt(st.params[k], 0.3)])) as Partial<GenerationParams>);
    return SAY.quakeGroove;
  }
  if (cls.contains('panel--tape')) {
    const keys: Array<keyof TapeParams> = ['warmth', 'wow', 'crush', 'space', 'vinyl', 'rain', 'hiss'];
    st.setTape(Object.fromEntries(keys.map((k) => [k, jolt(st.tape[k], 0.2)])) as Partial<TapeParams>);
    return SAY.quakeTape;
  }
  if (cls.contains('panel--filter')) {
    st.setTape({ cutoff: jolt(st.tape.cutoff, 0.3), resonance: jolt(st.tape.resonance, 0.25) });
    return SAY.quakeFilter;
  }
  if (cls.contains('panel--mixer')) {
    for (const l of LAYER_IDS) st.setMixerLevel(l, jolt(st.mixer[l], 0.15));
    return SAY.quakeMixer;
  }
  // the window, the tape deck and everything else: the tape skips to a whole new one
  void nextTape();
  return SAY.quakeNewTape;
}
