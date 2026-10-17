/**
 * Wild cat runner: wakes the brain on every bar line, turns its plans into exact audio-clock actions (mutes, acid,
 * station) and tells the overlay where the cat has to be, and when, so the animation lands on the downbeat.
 */
import type { LayerId } from '@shared/index';
import { MOODS } from '../composition/moods';
import { lfoSnapshot } from './modulator';
import { useStore } from './store';
import { WildBrain, type WildPlan } from './wildBrain';

/** One trip of the cat: travel to `target`, land at `landAt`, stay until `holdUntil`, then go home. */
export interface Excursion {
  id: number;
  /** CSS selector of the element the cat swats */
  target: string;
  /** performance.now() ms */
  landAt: number;
  holdUntil: number;
  label: string;
  /** shown when it swats again at the end (undoing a mute / letting go of the filter) */
  endLabel?: string;
}

type Listener = (e: Excursion | null) => void;
const listeners = new Set<Listener>();
let current: Excursion | null = null;

/** Subscribe to excursions (null = cancelled). */
export function onExcursion(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const currentExcursion = (): Excursion | null => current;

function emit(e: Excursion | null): void {
  current = e;
  for (const l of listeners) l(e);
}

export interface WildDeps {
  getBeat(): number;
  setCatMuted(layer: LayerId, muted: boolean, beat?: number): void;
  clearCatMutes(): void;
  acid(fromBeat: number, bars: number, accents: readonly boolean[], intensity: number): void;
  cancelAcid(): void;
  upcomingSections(): Array<{ beat: number; name: string; songIndex: number }>;
}

const LAYER_NAME: Record<LayerId, string> = { keys: 'keys', pad: 'pad', bass: 'bass', melody: 'lead', drums: 'drums', texture: 'room' };
/** time the cat needs to get home after its last swat (ms) */
const RETURN_MS = 1800;

let activeDeps: WildDeps | null = null;

/** The user clicked a layer the cat had muted: the user wins, the layer comes back right away. */
export function releaseCatMute(layer: LayerId): void {
  activeDeps?.setCatMuted(layer, false);
  useStore.getState().setCatMuted(layer, false);
}

export function startWildCat(deps: WildDeps): { stop(): void } {
  activeDeps = deps;
  const brain = new WildBrain();
  let lastBar = -1;
  let busyUntil = 0;
  let wasActive = false;
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let nextId = 1;

  const later = (ms: number, fn: () => void): void => {
    timers.push(setTimeout(fn, Math.max(0, ms)));
  };

  const cancelAll = (): void => {
    timers.forEach(clearTimeout);
    timers = [];
    deps.clearCatMutes();
    deps.cancelAcid();
    useStore.getState().clearCatMuted();
    brain.reset();
    busyUntil = 0;
    emit(null);
  };

  const run = (plan: WildPlan, beat: number, tempo: number): void => {
    const now = performance.now();
    const msAt = (b: number): number => now + (b - beat) * (60 / tempo) * 1000;
    const st = useStore.getState();
    let excursion: Omit<Excursion, 'id'>;
    switch (plan.kind) {
      case 'mute': {
        for (const l of plan.layers) {
          deps.setCatMuted(l, true, plan.fromBeat);
          deps.setCatMuted(l, false, plan.toBeat);
          later(msAt(plan.fromBeat) - now, () => useStore.getState().setCatMuted(l, true));
          later(msAt(plan.toBeat) - now, () => useStore.getState().setCatMuted(l, false));
        }
        excursion = {
          target: `[data-cat-target="mute-${plan.layers[0]}"]`,
          landAt: msAt(plan.fromBeat),
          holdUntil: msAt(plan.toBeat),
          label: `${plan.layers.map((l) => LAYER_NAME[l]).join(' + ')} off`,
          endLabel: 'back in!',
        };
        break;
      }
      case 'acid': {
        deps.acid(plan.fromBeat, plan.bars, plan.accents, plan.intensity);
        excursion = {
          target: '[data-cat-target="cutoff"]',
          landAt: msAt(plan.fromBeat),
          holdUntil: msAt(plan.fromBeat + plan.bars * 4),
          label: 'acid!',
        };
        break;
      }
      case 'station': {
        later(msAt(plan.atBeat) - now, () => st.setParams({ mood: plan.mood }));
        excursion = {
          target: `[data-cat-target="station-${plan.mood}"]`,
          landAt: msAt(plan.atBeat),
          holdUntil: msAt(plan.atBeat) + 1400,
          label: `→ ${MOODS[plan.mood].name}`,
        };
        break;
      }
    }
    busyUntil = excursion.holdUntil + RETURN_MS;
    emit({ id: nextId++, ...excursion });
    later(busyUntil - now, () => {
      if (current && current.holdUntil + RETURN_MS <= performance.now() + 50) emit(null);
    });
  };

  const timer = setInterval(() => {
    const st = useStore.getState();
    const wild = st.chaos.wildness > 0.01;
    const active = wild && st.playing && !st.busy;
    if (!active) {
      // turned to 0, or a new tape: everything the cat did is undone
      if (wasActive && (!wild || st.busy)) cancelAll();
      if (wasActive && !st.playing) {
        // paused: let pending audio actions stand, just bring the cat home
        emit(null);
      }
      wasActive = false;
      lastBar = -1;
      return;
    }
    wasActive = true;
    const beat = deps.getBeat();
    const bar = Math.floor(beat / 4);
    if (bar === lastBar) return;
    lastBar = bar;
    if (performance.now() < busyUntil) return;
    const lfo = lfoSnapshot();
    const plan = brain.onBar({
      bar,
      sectionName: st.now.sectionName,
      songIndex: st.now.songIndex,
      mood: st.params.mood,
      upcoming: deps.upcomingSections(),
      state: lfo.state,
      deriv: lfo.deriv,
      amount: st.chaos.wildness,
    });
    if (plan) run(plan, beat, st.now.tempo || 80);
  }, 60);

  return {
    stop: () => {
      clearInterval(timer);
      cancelAll();
    },
  };
}

let away = false;
/** Set by the overlay while the cat is out of the scope (the scope then hides its own cat). */
export function setCatAway(v: boolean): void {
  away = v;
}
export const isCatAway = (): boolean => away;
