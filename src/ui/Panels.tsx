import { useCallback, useState } from 'react';
import {
  DEFAULT_CHAOS, DEFAULT_MIXER, DEFAULT_PARAMS, DEFAULT_TAPE, FILTER_MODES, LAYER_IDS, MOOD_IDS,
  type FilterMode, type LayerId, type ModTarget, type TapeParams,
} from '@shared/index';
import { applyMod } from '../services/chaos';
import { ChaosScope } from './ChaosScope';
import { MOODS } from '../composition/moods';
import { TEMPO_MAX, TEMPO_MIN } from '../engine/localEngine';
import { tryGetController } from '../services/controller';
import { useStore } from '../services/store';
import { Knob } from './Knob';
import { errorMessage, randomSeed, useUiState } from './uiState';

const MOOD_ICONS: Record<string, string> = { study: '✎', rainy: '☂', sunday: '☼', drift: '≈' };

export function StationPanel() {
  const mood = useStore((s) => s.params.mood);
  const setParams = useStore((s) => s.setParams);
  return (
    <section className="panel panel--station" aria-labelledby="station-h">
      <h2 className="panel__title" id="station-h">Station</h2>
      <div className="stations" role="radiogroup" aria-labelledby="station-h">
        {MOOD_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mood === id}
            className={`station${mood === id ? ' is-active' : ''}`}
            onClick={() => setParams({ mood: id })}
          >
            <span className="station__led" aria-hidden="true" />
            <span className="station__icon" aria-hidden="true">{MOOD_ICONS[id]}</span>
            <span className="station__name">{MOODS[id].name}</span>
            <span className="station__blurb">{MOODS[id].blurb}</span>
          </button>
        ))}
      </div>
      <p className="panel__hint">Each station has its own pool of instruments, kits and grooves; every song picks a new combination. Switching station wraps up the current song within a few bars.</p>
    </section>
  );
}

/** Effective (chaos-modulated) value of a knob, or undefined when the LFO is not moving it. */
function useModded(target: ModTarget, base: number): number | undefined {
  const off = useStore((s) => s.mod[target]);
  return off ? applyMod(base, off) : undefined;
}

function GrooveKnob({ target, label, title }: { target: 'energy' | 'complexity' | 'variation' | 'swing'; label: string; title: string }) {
  const value = useStore((s) => s.params[target]);
  const setParams = useStore((s) => s.setParams);
  const mod = useModded(target, value);
  const onChange = useCallback((v: number) => setParams({ [target]: v }), [setParams, target]);
  return <Knob label={label} title={title} value={value} mod={mod} defaultValue={DEFAULT_PARAMS[target]} onChange={onChange} />;
}

export function GroovePanel() {
  const tempoParam = useStore((s) => s.params.tempo);
  const setParams = useStore((s) => s.setParams);
  const now = useStore((s) => s.now.tempo);
  const auto = tempoParam === null;
  const tempo = tempoParam ?? (now || 80);
  const tempo01 = (tempo - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN);
  const onTempo = useCallback((v: number) => setParams({ tempo: Math.round(TEMPO_MIN + v * (TEMPO_MAX - TEMPO_MIN)) }), [setParams]);
  return (
    <section className="panel panel--groove" aria-labelledby="groove-h">
      <h2 className="panel__title" id="groove-h">
        Groove <span className="panel__badge">live</span>
      </h2>
      <div className="knobs">
        <GrooveKnob target="energy" label="Energy" title="How hard it is played: drums, layers, touch" />
        <GrooveKnob target="complexity" label="Jazz" title="Triads to 13th chords, sparse to busy melodies (live)" />
        <GrooveKnob target="variation" label="Drift" title="How much patterns wander from bar to bar" />
        <GrooveKnob target="swing" label="Swing" title="Straight to hard shuffle" />
        <Knob label="Tempo" value={tempo01} display={auto ? `auto ${now ? now : ''}` : `${tempo} bpm`} onChange={onTempo} title="Drag to set a fixed tempo" />
      </div>
      <label className="toggle">
        <input type="checkbox" checked={auto} onChange={(e) => setParams({ tempo: e.currentTarget.checked ? null : Math.round(tempo) })} />
        <span>Auto tempo per song</span>
      </label>
    </section>
  );
}

type TapeKnobDef = { key: keyof TapeParams; label: string; title: string };

const TAPE_KNOBS: TapeKnobDef[] = [
  { key: 'warmth', label: 'Warmth', title: 'Tape low-pass: very muffled to open' },
  { key: 'wow', label: 'Wow', title: 'Wow & flutter (pitch wobble)' },
  { key: 'crush', label: 'Crush', title: 'Old-sampler bit crush' },
  { key: 'space', label: 'Space', title: 'Reverb: dry to cathedral' },
];

const AMBIENCE_KNOBS: TapeKnobDef[] = [
  { key: 'vinyl', label: 'Vinyl', title: 'Crackle and rumble' },
  { key: 'rain', label: 'Rain', title: 'Rain on the window' },
  { key: 'hiss', label: 'Hiss', title: 'Tape hiss' },
];

function TapeKnob({ def, size }: { def: TapeKnobDef; size?: 'sm' | 'lg' }) {
  const value = useStore((s) => s.tape[def.key]);
  const setTape = useStore((s) => s.setTape);
  const off = useStore((s) => s.mod[def.key as ModTarget]);
  const mod = off ? applyMod(value, off) : undefined;
  const onChange = useCallback((v: number) => setTape({ [def.key]: v }), [setTape, def.key]);
  return <Knob label={def.label} title={def.title} value={value} mod={mod} size={size} defaultValue={DEFAULT_TAPE[def.key]} onChange={onChange} />;
}

export function TapePanel() {
  return (
    <section className="panel panel--tape" aria-labelledby="tape-h">
      <h2 className="panel__title" id="tape-h">Tape</h2>
      <div className="knobs">
        {TAPE_KNOBS.map((k) => (
          <TapeKnob key={k.key} def={k} />
        ))}
      </div>
      <h2 className="panel__title panel__title--sub">Ambience</h2>
      <div className="knobs">
        {AMBIENCE_KNOBS.map((k) => (
          <TapeKnob key={k.key} def={k} />
        ))}
      </div>
    </section>
  );
}

const MODE_LABEL: Record<FilterMode, string> = { lowpass: 'LP', bandpass: 'BP', highpass: 'HP' };
/** sensible cutoff when switching mode (an open low-pass would be silent as a high-pass) */
const MODE_CUTOFF: Record<FilterMode, number> = { lowpass: 1, bandpass: 0.55, highpass: 0.12 };
const RESONANCE_DEF: TapeKnobDef = { key: 'resonance', label: 'Reso', title: 'Resonance: flat to screaming' };

function cutoffLabel(v: number): string {
  const hz = 40 * Math.pow(500, v);
  if (hz < 1000) return `${Math.round(hz)}`;
  return `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k`;
}

export function FilterPanel() {
  const mode = useStore((s) => s.filterMode);
  const cutoff = useStore((s) => s.tape.cutoff);
  const setFilterMode = useStore((s) => s.setFilterMode);
  const setTape = useStore((s) => s.setTape);
  const cutoffMod = useModded('cutoff', cutoff);
  const onCutoff = useCallback((v: number) => setTape({ cutoff: v }), [setTape]);
  return (
    <section className="panel panel--filter" aria-labelledby="filter-h">
      <h2 className="panel__title" id="filter-h">Filter</h2>
      <div className="segmented" role="radiogroup" aria-labelledby="filter-h">
        {FILTER_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={`segmented__btn${mode === m ? ' is-active' : ''}`}
            onClick={() => {
              if (m === mode) return;
              setFilterMode(m);
              setTape({ cutoff: MODE_CUTOFF[m] });
            }}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="knobs knobs--center">
        <Knob
          size="lg"
          label="Cutoff"
          value={cutoff}
          mod={cutoffMod}
          display={`${cutoffLabel(cutoffMod ?? cutoff)} Hz`}
          defaultValue={MODE_CUTOFF[mode]}
          onChange={onCutoff}
        />
        <TapeKnob size="lg" def={RESONANCE_DEF} />
      </div>
    </section>
  );
}

const CHAOS_GROUPS: Array<{ key: 'filter' | 'tape' | 'groove'; label: string; title: string }> = [
  { key: 'filter', label: 'Filter', title: 'Cutoff and resonance' },
  { key: 'tape', label: 'Tape', title: 'Warmth, wow, crush, space' },
  { key: 'groove', label: 'Groove', title: 'Energy, jazz, drift, swing' },
];

export function ChaosPanel() {
  const chaos = useStore((s) => s.chaos);
  const setChaos = useStore((s) => s.setChaos);
  const onAmount = useCallback((v: number) => setChaos({ amount: v }), [setChaos]);
  const onRate = useCallback((v: number) => setChaos({ rate: v }), [setChaos]);
  return (
    <section className="panel panel--chaos" aria-labelledby="chaos-h">
      <h2 className="panel__title" id="chaos-h">Cat</h2>
      <div className="chaos">
        <ChaosScope />
        <div className="chaos__controls">
          <div className="knobs">
            <Knob label="Amount" value={chaos.amount} defaultValue={DEFAULT_CHAOS.amount} onChange={onAmount} title="How far it pushes the knobs (0 = off)" />
            <Knob label="Rate" value={chaos.rate} defaultValue={DEFAULT_CHAOS.rate} onChange={onRate} title="Slow drift to restless" />
          </div>
          <div className="chaos__targets">
            {CHAOS_GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                title={g.title}
                aria-pressed={chaos[g.key]}
                className={`chip${chaos[g.key] ? ' is-active' : ''}`}
                onClick={() => setChaos({ [g.key]: !chaos[g.key] })}
              >
                <span className="chip__led" aria-hidden="true" />
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="panel__hint">
        A Lorenz attractor rides the knobs: smooth, never repeating, darker in breaks and brighter in solos. Dots on the knobs show where it is pushing.
      </p>
    </section>
  );
}

const LAYER_LABEL: Record<LayerId, string> = { keys: 'Keys', pad: 'Pad', bass: 'Bass', melody: 'Lead', drums: 'Drums', texture: 'Room' };

function Fader({ label, value, onChange, muted, onMute }: { label: string; value: number; onChange(v: number): void; muted?: boolean; onMute?(): void }) {
  return (
    <div className={`fader${muted ? ' is-muted' : ''}`}>
      <input
        className="fader__input"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        aria-label={`${label} level`}
        aria-valuetext={`${Math.round(value * 100)}%`}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <div className="fader__label">{label}</div>
      {onMute ? (
        <button type="button" className={`fader__mute${muted ? ' is-active' : ''}`} aria-pressed={!!muted} aria-label={`Mute ${label}`} onClick={onMute}>
          <span className="fader__led" aria-hidden="true" />
        </button>
      ) : (
        <div className="fader__mute fader__mute--spacer" />
      )}
    </div>
  );
}

export function MixerPanel() {
  const mixer = useStore((s) => s.mixer);
  const muted = useStore((s) => s.muted);
  const setLevel = useStore((s) => s.setMixerLevel);
  const setMuted = useStore((s) => s.setMuted);
  return (
    <section className="panel panel--mixer" aria-labelledby="mixer-h">
      <h2 className="panel__title" id="mixer-h">Mixer</h2>
      <div className="faders">
        {LAYER_IDS.map((l) => (
          <Fader key={l} label={LAYER_LABEL[l]} value={mixer[l]} muted={!!muted[l]} onMute={() => setMuted(l, !muted[l])} onChange={(v) => setLevel(l, v)} />
        ))}
        <Fader label="Master" value={mixer.master} onChange={(v) => setLevel('master', v)} />
      </div>
      <button
        type="button"
        className="btn btn--small"
        onClick={() => {
          for (const l of LAYER_IDS) setLevel(l, DEFAULT_MIXER[l]);
          setLevel('master', DEFAULT_MIXER.master);
        }}
      >
        Reset levels
      </button>
    </section>
  );
}

export function TapeInfo() {
  const seed = useStore((s) => s.params.seed);
  const busy = useStore((s) => s.busy);
  const exporting = useStore((s) => s.exporting);
  const audioReady = useStore((s) => s.audioReady);
  const history = useStore((s) => s.history);
  const notify = useUiState((s) => s.notify);
  const [draft, setDraft] = useState<string | null>(null);

  const load = async (value: number) => {
    const c = tryGetController();
    if (!c) return;
    try {
      await c.regenerate(value >>> 0);
    } catch (e) {
      notify('error', errorMessage(e));
    }
  };

  const exportWav = async () => {
    const c = tryGetController();
    if (!c) return;
    notify('info', 'Rendering 32 bars to WAV...');
    try {
      await c.exportWav(32);
      notify('info', 'WAV exported');
    } catch (e) {
      notify('error', `Export failed: ${errorMessage(e)}`);
    }
  };

  return (
    <section className="panel panel--info" aria-labelledby="info-h">
      <h2 className="panel__title" id="info-h">Cassette</h2>
      <form
        className="seed"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(draft);
          if (draft !== null && Number.isFinite(n) && draft.trim() !== '') void load(n);
          setDraft(null);
        }}
      >
        <label className="seed__label" htmlFor="seed-input">Seed</label>
        <input
          id="seed-input"
          className="seed__input"
          inputMode="numeric"
          value={draft ?? String(seed)}
          onChange={(e) => setDraft(e.currentTarget.value.replace(/[^0-9]/g, ''))}
          onBlur={() => setDraft(null)}
          disabled={busy}
        />
        <button type="submit" className="btn btn--small" disabled={busy || draft === null}>Load</button>
        <button type="button" className="btn btn--small" disabled={busy} onClick={() => void load(randomSeed())} title="Random seed">Random</button>
      </form>
      <h3 className="panel__title panel__title--sub">Tracklist</h3>
      {history.length ? (
        <ol className="tracklist">
          {history.map((h, i) => (
            <li key={`${h.index}-${h.title}`} className={i === 0 ? 'is-current' : ''}>
              <span className="tracklist__n">{String(h.index + 1).padStart(2, '0')}</span>
              <span className="tracklist__title">{h.title}</span>
              <span className="tracklist__key">{h.keyLabel}</span>
              {h.sound && <span className="tracklist__sound">{h.sound}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="panel__hint">Songs appear here as the tape plays.</p>
      )}
      <button type="button" className="btn btn--small btn--wide" onClick={() => void exportWav()} disabled={!audioReady || exporting}>
        {exporting ? 'Rendering...' : 'Export 32 bars (WAV)'}
      </button>
    </section>
  );
}
