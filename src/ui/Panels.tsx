import { useCallback, useState } from 'react';
import { DEFAULT_MIXER, DEFAULT_PARAMS, DEFAULT_TAPE, LAYER_IDS, MOOD_IDS, type LayerId, type TapeParams } from '@shared/index';
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
      <p className="panel__hint">Changing station finishes the current song, then the next one is in the new style.</p>
    </section>
  );
}

export function GroovePanel() {
  const params = useStore((s) => s.params);
  const setParams = useStore((s) => s.setParams);
  const now = useStore((s) => s.now.tempo);
  const auto = params.tempo === null;
  const tempo = params.tempo ?? (now || 80);
  const tempo01 = (tempo - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN);
  return (
    <section className="panel panel--groove" aria-labelledby="groove-h">
      <h2 className="panel__title" id="groove-h">Groove</h2>
      <div className="knobs">
        <Knob label="Energy" value={params.energy} defaultValue={DEFAULT_PARAMS.energy} onChange={useCallback((v) => setParams({ energy: v }), [setParams])} title="Busier drums, more layers" />
        <Knob label="Jazz" value={params.complexity} defaultValue={DEFAULT_PARAMS.complexity} onChange={useCallback((v) => setParams({ complexity: v }), [setParams])} title="Richer chords and melodies (applies from the next song for harmony)" />
        <Knob label="Drift" value={params.variation} defaultValue={DEFAULT_PARAMS.variation} onChange={useCallback((v) => setParams({ variation: v }), [setParams])} title="How much patterns wander from bar to bar" />
        <Knob label="Swing" value={params.swing} defaultValue={DEFAULT_PARAMS.swing} onChange={useCallback((v) => setParams({ swing: v }), [setParams])} />
        <Knob
          label="Tempo"
          value={tempo01}
          display={auto ? `auto ${now ? now : ''}` : `${tempo} bpm`}
          onChange={useCallback((v) => setParams({ tempo: Math.round(TEMPO_MIN + v * (TEMPO_MAX - TEMPO_MIN)) }), [setParams])}
          title="Drag to set a fixed tempo"
        />
      </div>
      <label className="toggle">
        <input type="checkbox" checked={auto} onChange={(e) => setParams({ tempo: e.currentTarget.checked ? null : Math.round(tempo) })} />
        <span>Auto tempo per song</span>
      </label>
    </section>
  );
}

const TAPE_KNOBS: Array<{ key: keyof TapeParams; label: string; title: string }> = [
  { key: 'warmth', label: 'Warmth', title: 'Tape low-pass: muffled to open' },
  { key: 'wow', label: 'Wow', title: 'Wow & flutter (pitch wobble)' },
  { key: 'crush', label: 'Crush', title: 'Old-sampler bit crush' },
  { key: 'space', label: 'Space', title: 'Reverb amount' },
];

const AMBIENCE_KNOBS: Array<{ key: keyof TapeParams; label: string; title: string }> = [
  { key: 'vinyl', label: 'Vinyl', title: 'Crackle and rumble' },
  { key: 'rain', label: 'Rain', title: 'Rain on the window' },
  { key: 'hiss', label: 'Hiss', title: 'Tape hiss' },
];

function TapeKnobs({ items }: { items: typeof TAPE_KNOBS }) {
  const tape = useStore((s) => s.tape);
  const setTape = useStore((s) => s.setTape);
  return (
    <div className="knobs">
      {items.map((k) => (
        <Knob key={k.key} label={k.label} title={k.title} value={tape[k.key]} defaultValue={DEFAULT_TAPE[k.key]} onChange={(v) => setTape({ [k.key]: v })} />
      ))}
    </div>
  );
}

export function TapePanel() {
  return (
    <section className="panel panel--tape" aria-labelledby="tape-h">
      <h2 className="panel__title" id="tape-h">Tape</h2>
      <TapeKnobs items={TAPE_KNOBS} />
      <h2 className="panel__title panel__title--sub">Ambience</h2>
      <TapeKnobs items={AMBIENCE_KNOBS} />
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
