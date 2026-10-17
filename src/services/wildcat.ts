/**
 * Wild cat runner: wakes the brain on every bar line, turns its plans into exact audio-clock actions (mutes, acid,
 * station) and tells the overlay where the cat has to be, and when, so the animation lands on the downbeat.
 *
 * It also keeps track of where the cat is. Besides its jobs, the cat naps on the windowsill of the pixel scene:
 * when it gets bored (idle for a while, how long is read from the LFO) or sometimes straight after a job. A job wakes it
 * (it travels from the window to the control); otherwise it wakes after its nap and walks home. Napping is not
 * mischief, so it also happens with Wild at 0.
 */
import type { LayerId } from '@shared/index';
import { MOODS } from '../composition/moods';
import { lfoSnapshot } from './modulator';
import { useStore } from './store';
import { WildBrain, type WildPlan } from './wildBrain';

export type CatPlace = 'home' | 'window';

/**
 * One trip of the cat.
 *  job:  from `from` to `target`, land at `landAt` (on the beat), stay until `holdUntil`, then go to `to`
 *  nap:  home -> windowsill (then sleeps there)
 *  wake: windowsill -> home
 */
export interface Excursion {
  id: number;
  kind: 'job' | 'nap' | 'wake';
  from: CatPlace;
  to: CatPlace;
  /** CSS selector of the element the cat swats (jobs) */
  target?: string;
  /** performance.now() ms */
  landAt: number;
  holdUntil: number;
  label?: string;
  /** shown when it swats again at the end (undoing a mute / letting go of the filter) */
  endLabel?: string;
  /** acid: the cat works the knob the whole time, one push per 16th (harder on accents) */
  wiggle?: { stepMs: number; accents: readonly boolean[] };
  /** the cat curls up on the control and sleeps until holdUntil */
  doze?: boolean;
}

type Listener = (e: Excursion | null) => void;
const listeners = new Set<Listener>();
let current: Excursion | null = null;

/** Subscribe to excursions (null = cancelled: the cat goes straight home). */
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
/** time the cat needs to get home (or to the window) after its last swat (ms) */
const RETURN_MS = 2400;
/** a stroll to or from the window (ms, the overlay goes at its own pace) */
const STROLL_MS = 3500;

let activeDeps: WildDeps | null = null;

/** The user clicked a layer the cat had muted: the user wins, the layer comes back right away. */
export function releaseCatMute(layer: LayerId): void {
  activeDeps?.setCatMuted(layer, false);
  useStore.getState().setCatMuted(layer, false);
}

const unit = (v: number): number => (Math.max(-1, Math.min(1, v)) + 1) / 2;

export function startWildCat(deps: WildDeps): { stop(): void } {
  activeDeps = deps;
  const brain = new WildBrain();
  let lastBar = -1;
  let busyUntil = 0;
  let wasWild = false;
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let nextId = 1;
  /** where the cat is (or is heading) */
  let place: CatPlace | 'out' = 'home';
  let napUntil = 0;
  let idleSince = performance.now();
  /** bars of doing nothing before the cat gets bored and goes for a nap */
  let boredAfterBars = 24;

  const later = (ms: number, fn: () => void): void => {
    timers.push(setTimeout(fn, Math.max(0, ms)));
  };

  const settle = (where: CatPlace, barMs: number): void => {
    place = where;
    idleSince = performance.now();
    const lfo = lfoSnapshot();
    boredAfterBars = 16 + Math.round(unit(lfo.state[2]) * 24);
    // a nap lasts 8..24 bars
    napUntil = where === 'window' ? performance.now() + (8 + Math.round(unit(lfo.state[0]) * 16)) * barMs : 0;
  };

  /** Undo the cat's mischief (switched to 0 / new tape). A napping cat keeps napping. */
  const cancelMischief = (): void => {
    timers.forEach(clearTimeout);
    timers = [];
    deps.clearCatMutes();
    deps.cancelAcid();
    useStore.getState().clearCatMuted();
    brain.reset();
    busyUntil = 0;
    if (place === 'out') {
      place = 'home';
      idleSince = performance.now();
      emit(null);
    }
  };

  const runJob = (plan: WildPlan, beat: number, tempo: number): void => {
    const now = performance.now();
    const barMs = (4 * 60 * 1000) / tempo;
    const msAt = (b: number): number => now + (b - beat) * (60 / tempo) * 1000;
    const st = useStore.getState();
    const from: CatPlace = place === 'window' ? 'window' : 'home';
    // after a job the cat sometimes skips going home and curls up in the window instead
    const to: CatPlace = lfoSnapshot().state[1] < -0.25 ? 'window' : 'home';
    let job: Omit<Excursion, 'id' | 'kind' | 'from' | 'to'>;
    switch (plan.kind) {
      case 'mute': {
        for (const l of plan.layers) {
          deps.setCatMuted(l, true, plan.fromBeat);
          deps.setCatMuted(l, false, plan.toBeat);
          later(msAt(plan.fromBeat) - now, () => useStore.getState().setCatMuted(l, true));
          later(msAt(plan.toBeat) - now, () => useStore.getState().setCatMuted(l, false));
        }
        job = {
          target: `[data-cat-target="mute-${plan.layers[0]}"]`,
          landAt: msAt(plan.fromBeat),
          holdUntil: msAt(plan.toBeat),
          label: plan.reason === 'nap' ? 'zzz…' : `${plan.layers.map((l) => LAYER_NAME[l]).join(' + ')} off`,
          endLabel: plan.reason === 'nap' ? `*yawn* ${LAYER_NAME[plan.layers[0]!]} back` : 'back in!',
          doze: plan.reason === 'nap',
        };
        break;
      }
      case 'acid': {
        deps.acid(plan.fromBeat, plan.bars, plan.accents, plan.intensity);
        job = {
          target: '[data-cat-target="cutoff"]',
          landAt: msAt(plan.fromBeat),
          holdUntil: msAt(plan.fromBeat + plan.bars * 4),
          label: 'acid!',
          wiggle: { stepMs: (60 / tempo) * 250, accents: plan.accents },
        };
        break;
      }
      case 'station': {
        later(msAt(plan.atBeat) - now, () => st.setParams({ mood: plan.mood }));
        job = {
          target: `[data-cat-target="station-${plan.mood}"]`,
          landAt: msAt(plan.atBeat),
          holdUntil: msAt(plan.atBeat) + 1400,
          label: `→ ${MOODS[plan.mood].name}`,
        };
        break;
      }
    }
    place = 'out';
    napUntil = 0;
    busyUntil = job.holdUntil + RETURN_MS;
    emit({ id: nextId++, kind: 'job', from, to, ...job });
    later(busyUntil - now, () => {
      if (place === 'out') settle(to, barMs);
    });
  };

  const stroll = (kind: 'nap' | 'wake', barMs: number): void => {
    const now = performance.now();
    const to: CatPlace = kind === 'nap' ? 'window' : 'home';
    place = 'out';
    busyUntil = now + STROLL_MS;
    emit({ id: nextId++, kind, from: kind === 'nap' ? 'home' : 'window', to, landAt: now, holdUntil: now });
    later(STROLL_MS, () => {
      if (place === 'out') settle(to, barMs);
    });
  };

  const timer = setInterval(() => {
    const st = useStore.getState();
    const wild = st.chaos.wildness > 0.01;
    if (wasWild && (!wild || st.busy)) cancelMischief();
    wasWild = wild && !st.busy;
    if (!st.playing || st.busy) {
      // paused: a cat out on a job comes home; a napping cat keeps sleeping
      if (place === 'out' && !st.playing) {
        place = 'home';
        busyUntil = 0;
        emit(null);
      }
      lastBar = -1;
      return;
    }
    const beat = deps.getBeat();
    const bar = Math.floor(beat / 4);
    if (bar === lastBar) return;
    lastBar = bar;
    const now = performance.now();
    if (now < busyUntil) return;
    const tempo = st.now.tempo || 80;
    const barMs = (4 * 60 * 1000) / tempo;

    // ---- mischief first: a job wakes a napping cat
    if (wild) {
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
      if (plan) {
        runJob(plan, beat, tempo);
        return;
      }
    }

    // ---- naps
    if (place === 'window' && napUntil && now >= napUntil) stroll('wake', barMs);
    else if (place === 'home' && now - idleSince >= boredAfterBars * barMs) stroll('nap', barMs);
  }, 60);

  return {
    stop: () => {
      clearInterval(timer);
      cancelMischief();
    },
  };
}

let away = false;
let napping = false;
/** Set by the overlay while the cat is out of the scope (the scope then hides its own cat). */
export function setCatAway(v: boolean): void {
  away = v;
}
export const isCatAway = (): boolean => away;

/** Set by the overlay while the cat sleeps on the windowsill (the pixel scene draws it there). */
export function setCatNapping(v: boolean): void {
  napping = v;
}
export const isCatNapping = (): boolean => napping;
