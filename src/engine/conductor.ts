import type { EventBatch, GenerationParams, LayerId, SectionEvent } from '@shared/index';
import { LAYER_IDS } from '@shared/index';
import type { AudioRenderer } from '../audio/types';
import type { ComposerEngine } from './types';
import type { PlaybackController } from '../services/controller';
import { effectiveParams, effectiveTape } from '../services/effective';
import { INITIAL_NOW, useStore, type AppState, type NowPlaying } from '../services/store';
import { keyLabel } from '../composition/theory';
import { PATCH_LABELS } from '../composition/sounds';

/** How far ahead (beats) of the audio clock notes are scheduled: 2 bars. */
const LOOKAHEAD_BEATS = 8;
/** Max bars rendered per pump tick (a stalled tab can't produce a giant burst). */
const MAX_BARS_PER_TICK = 4;
/** Pump interval; note timing never depends on it (events carry absolute beats). */
const PUMP_MS = 150;
/** UI read-out refresh interval. */
const NOW_MS = 100;
/** Groove changes are re-rendered from this far ahead of the audible position (covers the audio lookahead). */
const FLUSH_MARGIN_BEATS = 0.4;
/** Coalesce knob drags into at most one re-render per this many ms. */
const FLUSH_DEBOUNCE_MS = 70;

type Marker = { beat: number; type: 'section'; ev: SectionEvent } | { beat: number; type: 'tempo'; tempo: number };

const grooveChanged = (a: GenerationParams, b: GenerationParams): boolean =>
  a.energy !== b.energy || a.complexity !== b.complexity || a.variation !== b.variation || a.swing !== b.swing || a.tempo !== b.tempo;

/** The composition controls actually used: user knobs + chaos offsets. */
const liveParams = (st: AppState): GenerationParams => effectiveParams(st.params, st.mod);

/**
 * Owns the generate-ahead loop between a ComposerEngine and an AudioRenderer. Asks the engine for one bar at a time,
 * ~2 bars ahead of the audio clock, with the CURRENT (chaos-modulated) controls. When the user moves a groove control,
 * everything scheduled after the next fraction of a beat is cancelled and re-composed, so the change is heard
 * almost immediately. Display state is derived by replaying Section events when the clock reaches them.
 */
export class Conductor implements PlaybackController {
  private engine: ComposerEngine;
  private nextBar = 0;
  private started = false;
  private playing = false;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private nowTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private markers: Marker[] = [];
  private pumping = false;
  private unsubscribe: Array<() => void> = [];
  private resetting: Promise<void> | null = null;

  constructor(
    private readonly renderer: AudioRenderer,
    private readonly engineFactory: () => ComposerEngine,
  ) {
    this.engine = engineFactory();
    this.unsubscribe.push(
      useStore.subscribe((state, prev) => {
        if (!this.started) return;
        if (state.mixer !== prev.mixer) this.renderer.setMixer(state.mixer);
        if (state.tape !== prev.tape || state.mod !== prev.mod) this.renderer.setTape(effectiveTape(state.tape, state.mod));
        if (state.filterMode !== prev.filterMode) this.renderer.setFilterMode(state.filterMode);
        if (state.params.mood !== prev.params.mood) this.renderer.setMood(state.params.mood);
        if (state.muted !== prev.muted) {
          for (const l of LAYER_IDS) if (!!state.muted[l] !== !!prev.muted[l]) this.renderer.setLayerMuted(l, !!state.muted[l]);
        }
        if (grooveChanged(state.params, prev.params)) this.scheduleFlush();
      }),
    );
  }

  async play(): Promise<void> {
    const st = useStore.getState();
    if (!this.started) {
      this.renderer.setMood(st.params.mood);
      this.renderer.setMixer(st.mixer);
      this.renderer.setTape(effectiveTape(st.tape, st.mod));
      this.renderer.setFilterMode(st.filterMode);
      for (const l of Object.keys(st.muted) as LayerId[]) this.renderer.setLayerMuted(l, !!st.muted[l]);
      await this.renderer.start();
      this.started = true;
      this.engine.init(st.params.seed, st.params);
      this.nextBar = 0;
      this.markers = [];
      useStore.getState().setAudioReady(true);
    }
    if (this.resetting) await this.resetting;
    this.pump(true); // pre-fill before the clock starts
    this.renderer.play();
    this.playing = true;
    useStore.getState().setPlaying(true);
    this.startTimers();
  }

  pause(): void {
    if (!this.started) return;
    this.renderer.pause();
    this.playing = false;
    useStore.getState().setPlaying(false);
    this.stopTimers();
  }

  async regenerate(newSeed?: number): Promise<void> {
    if (!this.started) {
      if (newSeed !== undefined) useStore.getState().setParams({ seed: newSeed });
      return;
    }
    if (this.resetting) return this.resetting;
    this.resetting = this.doRegenerate(newSeed).finally(() => {
      this.resetting = null;
    });
    return this.resetting;
  }

  private async doRegenerate(newSeed?: number): Promise<void> {
    const store = useStore.getState();
    const wasPlaying = this.playing;
    store.setBusy(true);
    this.stopTimers();
    try {
      if (newSeed !== undefined) store.setParams({ seed: newSeed });
      await this.renderer.reset();
      const params = useStore.getState().params;
      this.engine = this.engineFactory();
      this.engine.init(params.seed, params);
      this.nextBar = 0;
      this.markers = [];
      useStore.getState().setNow({ ...INITIAL_NOW });
      this.pump(true);
      if (wasPlaying) {
        this.renderer.play();
        this.startTimers();
      }
    } finally {
      useStore.getState().setBusy(false);
    }
  }

  async exportWav(bars: number): Promise<void> {
    const { params, mixer, tape, filterMode } = useStore.getState();
    const { exportWav } = await import('./exportWav');
    useStore.getState().setExporting(true);
    try {
      await exportWav(this.engineFactory(), params, mixer, tape, filterMode, bars);
    } finally {
      useStore.getState().setExporting(false);
    }
  }

  /** Section / chord markers already composed but not yet heard (about 2 bars ahead). */
  upcomingSections(): Array<{ beat: number; name: string; songIndex: number }> {
    const out: Array<{ beat: number; name: string; songIndex: number }> = [];
    for (const m of this.markers) if (m.type === 'section') out.push({ beat: m.beat, name: m.ev.name, songIndex: m.ev.songIndex });
    return out;
  }

  dispose(): void {
    this.stopTimers();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.renderer.dispose();
  }

  // ---- internals --------------------------------------------------------------------------

  private startTimers(): void {
    if (this.pumpTimer === null) this.pumpTimer = setInterval(() => this.pump(false), PUMP_MS);
    if (this.nowTimer === null) this.nowTimer = setInterval(() => this.updateNow(), NOW_MS);
  }

  private stopTimers(): void {
    if (this.pumpTimer !== null) clearInterval(this.pumpTimer);
    if (this.nowTimer !== null) clearInterval(this.nowTimer);
    this.pumpTimer = null;
    this.nowTimer = null;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  /** Drop everything scheduled from just ahead of the audible position and compose it again with the new controls. */
  private flush(): void {
    if (!this.started || this.resetting || this.pumping) return;
    const cut = this.renderer.getBeat() + FLUSH_MARGIN_BEATS;
    const cutBar = Math.floor(cut / 4);
    if (cutBar >= this.nextBar) return; // nothing scheduled there yet
    this.renderer.cancelFrom(cut);
    this.engine.rewind(cutBar);
    this.markers = this.markers.filter((m) => m.beat < cut);
    this.nextBar = cutBar;
    this.pump(true, cut);
  }

  /** Render bars until we are LOOKAHEAD_BEATS ahead of the audio clock. Events before `from` are skipped. */
  private pump(initialFill: boolean, from = -Infinity): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const params = liveParams(useStore.getState());
      const maxBars = initialFill ? LOOKAHEAD_BEATS / 4 + 1 : MAX_BARS_PER_TICK;
      for (let i = 0; i < maxBars; i++) {
        if (this.nextBar * 4 - this.renderer.getBeat() >= LOOKAHEAD_BEATS) break;
        let batch = this.engine.renderBars(this.nextBar, 1, params);
        if (from > batch.startBeat) batch = { ...batch, events: batch.events.filter((e) => e.beat >= from) };
        this.collectMarkers(batch);
        this.renderer.schedule(batch);
        this.nextBar += 1;
      }
    } catch (err) {
      console.error('[Conductor] generation failed', err);
    } finally {
      this.pumping = false;
    }
  }

  private collectMarkers(batch: EventBatch): void {
    const lastTempo = [...this.markers].reverse().find((m) => m.type === 'tempo');
    if (!lastTempo || (lastTempo.type === 'tempo' && lastTempo.tempo !== batch.tempo)) {
      this.markers.push({ beat: batch.startBeat, type: 'tempo', tempo: batch.tempo });
    }
    for (const ev of batch.events) if (ev.kind === 'section') this.markers.push({ beat: ev.beat, type: 'section', ev });
    this.markers.sort((a, b) => a.beat - b.beat);
  }

  private updateNow(): void {
    const beat = this.renderer.getBeat();
    const store = useStore.getState();
    const patch: Partial<NowPlaying> = {};
    while (this.markers.length && this.markers[0]!.beat <= beat + 0.01) {
      const m = this.markers.shift()!;
      if (m.type === 'tempo') {
        patch.tempo = Math.round(m.tempo);
      } else {
        const key = keyLabel(m.ev.key);
        patch.keyLabel = key;
        patch.sectionName = m.ev.name;
        patch.palette = m.ev.palette;
        patch.groove = m.ev.groove;
        if (m.ev.chord) patch.chordLabel = m.ev.chord.label;
        if (m.ev.songIndex !== (patch.songIndex ?? store.now.songIndex)) {
          patch.songIndex = m.ev.songIndex;
          patch.songTitle = m.ev.songTitle;
          patch.songStartBar = Math.round(m.ev.beat / 4);
          store.pushHistory({ index: m.ev.songIndex, title: m.ev.songTitle, keyLabel: key, sound: `${PATCH_LABELS.keys[m.ev.palette.keys]} · ${m.ev.groove}` });
        }
      }
    }
    const bar = Math.floor(beat / 4);
    const beatInBar = beat - bar * 4;
    if (store.now.bar !== bar) patch.bar = bar;
    if (Math.floor(store.now.beatInBar * 4) !== Math.floor(beatInBar * 4)) patch.beatInBar = beatInBar;
    if (Object.keys(patch).length) useStore.getState().setNow(patch);
  }
}
