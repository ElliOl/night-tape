import type { EventBatch, LayerId, SectionEvent } from '@shared/index';
import { LAYER_IDS } from '@shared/index';
import type { AudioRenderer } from '../audio/types';
import type { ComposerEngine } from './types';
import type { PlaybackController } from '../services/controller';
import { INITIAL_NOW, useStore, type NowPlaying } from '../services/store';
import { keyLabel } from '../composition/theory';

/** How far ahead (beats) of the audio clock notes are scheduled: 4 bars. */
const LOOKAHEAD_BEATS = 16;
/** Max bars rendered per pump tick (a stalled tab can't produce a giant burst). */
const MAX_BARS_PER_TICK = 4;
/** Pump interval; note timing never depends on it (events carry absolute beats). */
const PUMP_MS = 200;
/** UI read-out refresh interval. */
const NOW_MS = 100;

type Marker = { beat: number; type: 'section'; ev: SectionEvent } | { beat: number; type: 'tempo'; tempo: number };

/**
 * Owns the generate-ahead loop between a ComposerEngine and an AudioRenderer. Asks the engine for one bar at a time,
 * ~4 bars ahead of the audio clock, always with the CURRENT params, so control changes are heard within a few bars.
 * Display state (song/key/chord/section/tempo) is derived by replaying Section events when the clock reaches them.
 */
export class Conductor implements PlaybackController {
  private engine: ComposerEngine;
  private nextBar = 0;
  private started = false;
  private playing = false;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private nowTimer: ReturnType<typeof setInterval> | null = null;
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
        if (state.tape !== prev.tape) this.renderer.setTape(state.tape);
        if (state.params.mood !== prev.params.mood) this.renderer.setMood(state.params.mood);
        if (state.muted !== prev.muted) {
          for (const l of LAYER_IDS) if (!!state.muted[l] !== !!prev.muted[l]) this.renderer.setLayerMuted(l, !!state.muted[l]);
        }
      }),
    );
  }

  async play(): Promise<void> {
    const st = useStore.getState();
    if (!this.started) {
      this.renderer.setMood(st.params.mood);
      this.renderer.setMixer(st.mixer);
      this.renderer.setTape(st.tape);
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
    const { params, mixer, tape } = useStore.getState();
    const { exportWav } = await import('./exportWav');
    useStore.getState().setExporting(true);
    try {
      await exportWav(this.engineFactory(), params, mixer, tape, bars);
    } finally {
      useStore.getState().setExporting(false);
    }
  }

  dispose(): void {
    this.stopTimers();
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

  /** Render bars until we are LOOKAHEAD_BEATS ahead of the audio clock. */
  private pump(initialFill: boolean): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const params = useStore.getState().params;
      const maxBars = initialFill ? LOOKAHEAD_BEATS / 4 : MAX_BARS_PER_TICK;
      for (let i = 0; i < maxBars; i++) {
        if (this.nextBar * 4 - this.renderer.getBeat() >= LOOKAHEAD_BEATS) break;
        const batch = this.engine.renderBars(this.nextBar, 1, params);
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
        if (m.ev.chord) patch.chordLabel = m.ev.chord.label;
        if (m.ev.songIndex !== (patch.songIndex ?? store.now.songIndex)) {
          patch.songIndex = m.ev.songIndex;
          patch.songTitle = m.ev.songTitle;
          patch.songStartBar = Math.round(m.ev.beat / 4);
          store.pushHistory({ index: m.ev.songIndex, title: m.ev.songTitle, keyLabel: key });
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
