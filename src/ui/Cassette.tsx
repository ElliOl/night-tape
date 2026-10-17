import { useId } from 'react';
import { useStore } from '../services/store';
import { cassetteColors, sketchSeed } from './cassettePalettes';

/** Bars over which the tape visibly winds from the left reel to the right one. */
const WIND_BARS = 64;
const INK = '#1d1713';
const TAPE = '#5e3d2a';
const TAPE_LIGHT = '#f1e3c8';

/** Notched white reel (the hub turns while playing). */
function Reel({ cx, cy, pack, spinning }: { cx: number; cy: number; pack: number; spinning: boolean }) {
  return (
    <g>
      {/* wound tape around the hub */}
      <circle cx={cx} cy={cy} r={13 + pack * 4.5} style={{ fill: TAPE }} />
      <g className={`cassette__reel${spinning ? ' is-spinning' : ''}`} style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <circle cx={cx} cy={cy} r={12.5} fill="#fbf8f2" stroke={INK} strokeWidth={2.2} />
        <circle cx={cx} cy={cy} r={8.4} fill={INK} />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect key={a} x={cx - 1.6} y={cy - 8.6} width={3.2} height={4.4} rx={0.6} fill="#fbf8f2" transform={`rotate(${a} ${cx} ${cy})`} />
        ))}
        <circle cx={cx} cy={cy} r={4.3} fill="#fbf8f2" />
      </g>
    </g>
  );
}

function Screw({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={5} fill="#f6f1e7" stroke={INK} strokeWidth={2} />
      <path d={`M${x - 2.6} ${y} H${x + 2.6} M${x} ${y - 2.6} V${y + 2.6}`} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
    </g>
  );
}

/**
 * Hand-drawn cassette: thick ink outlines with a slight wobble (SVG turbulence), screws, a handwritten sticker with the
 * song title, notched reels that turn while playing and a tape window that winds across the song. Every song gets its
 * own soothing colour scheme (seeded, weighted per station) and a slightly different "drawing" of the outline.
 */
export function Cassette() {
  const uid = useId().replace(/:/g, '');
  const playing = useStore((s) => s.playing);
  const title = useStore((s) => s.now.songTitle);
  const songIndex = useStore((s) => s.now.songIndex);
  const bar = useStore((s) => s.now.bar);
  const start = useStore((s) => s.now.songStartBar);
  const busy = useStore((s) => s.busy);
  const seed = useStore((s) => s.params.seed);
  const mood = useStore((s) => s.params.mood);

  const song = Math.max(0, songIndex);
  const c = cassetteColors(seed, song, mood);
  const progress = Math.min(1, Math.max(0, (bar - start) / WIND_BARS));
  // a "(b-side)" song is on side B of the tape; everything else plays from side A
  const side = /b-side/i.test(title) ? 'B' : 'A';
  const text = busy ? 'rewinding...' : title || 'night tape';
  const longText = text.length * 9.6 > 168;
  const spinning = playing && !busy;

  const sketch = `sketch-${uid}`;
  const panelClip = `panel-${uid}`;

  return (
    <svg className="cassette" viewBox="0 0 300 190" role="img" aria-label={title ? `Now playing: ${title}` : 'Cassette'}>
      <defs>
        <filter id={sketch} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={sketchSeed(seed, song)} />
          <feDisplacementMap in="SourceGraphic" scale={2.4} />
        </filter>
        <clipPath id={panelClip}>
          <rect x={30} y={24} width={240} height={114} rx={8} />
        </clipPath>
      </defs>

      <g filter={`url(#${sketch})`}>
        {/* shell, with a faint second pencil pass */}
        <rect x={6} y={6} width={288} height={178} rx={13} style={{ fill: c.body }} stroke={INK} strokeWidth={4.5} />
        <rect x={7.5} y={7.5} width={286} height={176} rx={12} fill="none" stroke={INK} strokeOpacity={0.25} strokeWidth={1.4} transform="rotate(0.4 150 95)" />

        {/* label panel with stripe and shine */}
        <rect x={30} y={24} width={240} height={114} rx={8} style={{ fill: c.panel }} />
        <g clipPath={`url(#${panelClip})`}>
          {c.stripe && <rect x={30} y={64} width={240} height={40} style={{ fill: c.stripe }} />}
          {c.pinstripe && (
            <>
              <rect x={30} y={c.stripe ? 108 : 118} width={240} height={2.4} style={{ fill: c.pinstripe }} />
              <rect x={30} y={c.stripe ? 113 : 123} width={240} height={2.4} style={{ fill: c.pinstripe }} />
            </>
          )}
          {[60, 120, 190, 245].map((x) => (
            <path key={x} d={`M${x} 140 L${x + 48} 20`} stroke="#ffffff" strokeOpacity={0.22} strokeWidth={x % 120 === 0 ? 6 : 3} strokeLinecap="round" />
          ))}
        </g>
        <rect x={30} y={24} width={240} height={114} rx={8} fill="none" stroke={INK} strokeWidth={2.6} />

        {/* sticker with the title, handwritten */}
        <rect x={62} y={30} width={176} height={28} rx={4} style={{ fill: c.sticker }} stroke={INK} strokeWidth={1.6} />
        <text
          x={150}
          y={51}
          textAnchor="middle"
          className="cassette__title"
          style={{ fill: c.ink }}
          textLength={longText ? 164 : undefined}
          lengthAdjust={longText ? 'spacingAndGlyphs' : undefined}
        >
          {text}
        </text>
        <text x={259} y={51} textAnchor="middle" className="cassette__side" style={{ fill: c.ink }}>
          {side}
        </text>

        {/* reel window */}
        <rect x={78} y={66} width={144} height={38} rx={19} fill={INK} stroke={INK} strokeWidth={3} />
        <rect x={81} y={69} width={138} height={32} rx={16} style={{ fill: c.body }} fillOpacity={0.35} />
        <Reel cx={104} cy={85} pack={1 - progress} spinning={spinning} />
        <Reel cx={196} cy={85} pack={progress} spinning={spinning} />
        {/* centre window: the tape still to play (dark) and what has played (light) */}
        <rect x={128} y={77} width={44} height={16} fill={TAPE_LIGHT} stroke={INK} strokeWidth={1.8} />
        <rect x={128} y={77} width={8 + 36 * (1 - progress)} height={16} style={{ fill: TAPE }} />
        <rect x={128} y={77} width={44} height={16} fill="none" stroke={INK} strokeWidth={1.8} />

        {/* bottom guide with holes */}
        <path d="M66 184 L82 148 H218 L234 184" style={{ fill: c.body }} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        <path d="M66 184 L82 148 H218 L234 184" fill="#000" fillOpacity={0.08} />
        <circle cx={104} cy={170} r={5.5} fill="#fbf8f2" stroke={INK} strokeWidth={2} />
        <rect x={121} y={163} width={8} height={8} rx={1.5} fill="#fbf8f2" stroke={INK} strokeWidth={1.8} />
        <rect x={171} y={163} width={8} height={8} rx={1.5} fill="#fbf8f2" stroke={INK} strokeWidth={1.8} />
        <circle cx={196} cy={170} r={5.5} fill="#fbf8f2" stroke={INK} strokeWidth={2} />
        <Screw x={150} y={160} />

        <Screw x={18} y={18} />
        <Screw x={282} y={18} />
        <Screw x={18} y={172} />
        <Screw x={282} y={172} />
      </g>
    </svg>
  );
}
