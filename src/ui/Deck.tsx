import { useEffect, useRef } from 'react';
import { paletteSummary } from '../composition/sounds';
import { useStore } from '../services/store';
import { Cassette } from './Cassette';
import { nextTape, togglePlayback } from './uiState';
import { getVisualizerSource } from './visualizerSource';

const VU_SEGMENTS = 14;

/** LED VU meter driven straight from the analyser (no React re-render per frame). */
function Vu() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const segs = Array.from(ref.current?.children ?? []) as HTMLElement[];
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const level = getVisualizerSource()?.getLevel() ?? 0;
      // -42..0 dB across the strip
      const db = level > 0 ? 20 * Math.log10(level) : -100;
      const lit = Math.round(((db + 42) / 42) * VU_SEGMENTS);
      segs.forEach((s, i) => s.classList.toggle('is-on', i < lit));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="vu" ref={ref} aria-hidden="true">
      {Array.from({ length: VU_SEGMENTS }, (_, i) => (
        <span key={i} className={`vu__seg${i >= VU_SEGMENTS - 2 ? ' vu__seg--hot' : i >= VU_SEGMENTS - 5 ? ' vu__seg--warm' : ''}`} />
      ))}
    </div>
  );
}

function Steps() {
  const beatInBar = useStore((s) => s.now.beatInBar);
  const playing = useStore((s) => s.playing);
  const step = Math.floor(beatInBar * 4) % 16;
  return (
    <div className="steps" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <span key={i} className={`steps__led${i % 4 === 0 ? ' steps__led--beat' : ''}${playing && i === step ? ' is-on' : ''}`} />
      ))}
    </div>
  );
}

function Readout({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`readout${wide ? ' readout--wide' : ''}`}>
      <div className="readout__label">{label}</div>
      <div className="readout__value">{value}</div>
    </div>
  );
}

/** Transport + now-playing displays around the cassette. */
export function Deck() {
  const playing = useStore((s) => s.playing);
  const busy = useStore((s) => s.busy);
  const now = useStore((s) => s.now);
  const tempoOverride = useStore((s) => s.params.tempo);

  return (
    <section className="deck panel" aria-label="Tape deck">
      <div className="deck__cassette">
        <Cassette />
      </div>
      <div className="deck__side">
        <div className="deck__now">
          <div className="deck__eyebrow">now playing</div>
          <div className="deck__title" aria-live="polite">
            {now.songTitle || '—'}
          </div>
          {now.palette && (
            <div className="deck__sound">
              {paletteSummary(now.palette)} · {now.groove}
            </div>
          )}
        </div>
        <div className="deck__readouts">
          <Readout label="key" value={now.keyLabel} wide />
          <Readout label="chord" value={now.chordLabel} />
          <Readout label="part" value={now.sectionName} />
          <Readout label="bpm" value={now.tempo ? String(tempoOverride ?? now.tempo) : '-'} />
        </div>
        <div className="deck__meters">
          <Steps />
          <Vu />
        </div>
        <div className="deck__transport">
          <button
            type="button"
            className={`btn btn--play${playing ? ' is-active' : ''}`}
            onClick={() => void togglePlayback()}
            aria-label={playing ? 'Pause' : 'Play'}
            disabled={busy}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
            )}
            <span>{playing ? 'Pause' : 'Play'}</span>
          </button>
          <button type="button" className="btn" onClick={() => void nextTape()} disabled={busy} title="New seed: a whole new tape">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6v12l8.5-6zM14 6v12l8.5-6z" /></svg>
            <span>New tape</span>
          </button>
        </div>
      </div>
    </section>
  );
}
