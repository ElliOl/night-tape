import { useId } from 'react';
import { useStore } from '../services/store';
import { cassetteColors, sketchSeed } from './cassettePalettes';

/** Bars over which the tape visibly winds from the left reel to the right one. */
const WIND_BARS = 64;
const INK = '#1d1713';
const TAPE = '#4a2f20';
const TAPE_LIGHT = '#cbbd9f';

/** Notched white reel (the hub turns while playing). */
function Reel({ cx, cy, pack, spinning }: { cx: number; cy: number; pack: number; spinning: boolean }) {
  return (
    <g>
      {/* wound tape around the hub */}
      <circle cx={cx} cy={cy} r={13 + pack * 4.5} style={{ fill: TAPE }} />
      <g className={`cassette__reel${spinning ? ' is-spinning' : ''}`} style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <circle cx={cx} cy={cy} r={12.5} fill="#d8ceb9" stroke={INK} strokeWidth={2.2} />
        <circle cx={cx} cy={cy} r={8.4} fill={INK} />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect key={a} x={cx - 1.6} y={cy - 8.6} width={3.2} height={4.4} rx={0.6} fill="#d8ceb9" transform={`rotate(${a} ${cx} ${cy})`} />
        ))}
        <circle cx={cx} cy={cy} r={4.3} fill="#d8ceb9" />
      </g>
    </g>
  );
}

/** Tiny deterministic PRNG so the wear marks stay put while the knob moves. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_SPECKS = 60;
const MAX_SCRATCHES = 12;

/**
 * Wear marks over the shell, in the order they appear as the wear knob turns up: dust specks and scratches first,
 * then a yellowed label and a coffee ring. (The chewed tape is drawn separately, behind the shell.)
 */
function Wear({ wear, seed }: { wear: number; seed: number }) {
  const r = prng(seed ^ 0x5eed);
  const specks = Array.from({ length: MAX_SPECKS }, () => ({ x: 10 + r() * 280, y: 10 + r() * 170, s: 0.5 + r() * 1.3 }));
  const scratches = Array.from({ length: MAX_SCRATCHES }, () => {
    const x = 14 + r() * 260;
    const y = 14 + r() * 150;
    const a = r() * Math.PI;
    const l = 8 + r() * 30;
    return `M${x.toFixed(1)} ${y.toFixed(1)} l${(Math.cos(a) * l).toFixed(1)} ${(Math.sin(a) * l).toFixed(1)}`;
  });
  const nSpecks = Math.round(wear * MAX_SPECKS);
  const nScratches = Math.round(Math.max(0, wear - 0.15) / 0.85 * MAX_SCRATCHES);
  const yellow = Math.max(0, wear - 0.3) / 0.7;
  return (
    <g pointerEvents="none">
      {yellow > 0 && <rect x={62} y={30} width={176} height={28} rx={4} fill="#b8862e" fillOpacity={0.32 * yellow} />}
      {wear > 0.55 && (
        <circle cx={214} cy={44} r={11} fill="none" stroke="#6b4423" strokeOpacity={0.28 * Math.min(1, (wear - 0.55) / 0.2)} strokeWidth={2.2} strokeDasharray="20 3 9 4" />
      )}
      {specks.slice(0, nSpecks).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.s} fill={i % 3 === 0 ? '#f4ecd8' : INK} fillOpacity={0.3} />
      ))}
      {scratches.slice(0, nScratches).map((d, i) => (
        <path key={i} d={d} stroke="#f4ecd8" strokeOpacity={0.35} strokeWidth={0.8} strokeLinecap="round" />
      ))}
    </g>
  );
}

/**
 * Chewed tape: once wear passes 0.6 a loop of tape pulls out of the head slot at the bottom and grows into two big
 * sagging loops. Drawn before the bottom guide so it comes out from inside the shell instead of lying on top of it.
 */
function ChewedTape({ wear }: { wear: number }) {
  const c = Math.max(0, wear - 0.6) / 0.4;
  if (c <= 0) return null;
  // how far below the shell's bottom edge (y 184) the loops hang
  const hang = 8 + 34 * c;
  const spread = 18 + 50 * c;
  const y = 184 + hang;
  const d = [
    'M138 160',
    `C136 ${184 + hang * 0.5} ${150 - spread} ${y + 4} ${150 - spread - 6} ${y - hang * 0.45}`,
    `S${140 - spread * 0.3} ${186} ${146} ${190 + hang * 0.3}`,
    `S${150 + spread} ${y + 6} ${150 + spread + 4} ${y - hang * 0.4}`,
    `S${166} ${184 + hang * 0.2} 162 160`,
  ].join(' ');
  return (
    <g pointerEvents="none" opacity={Math.min(1, c * 2)}>
      <path d={d} fill="none" stroke={INK} strokeWidth={5.6} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" style={{ stroke: TAPE }} strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" />
      {/* a sheen where the crinkled tape catches the light */}
      <path d={d} fill="none" stroke="#c9a37a" strokeOpacity={0.35} strokeWidth={0.8} strokeDasharray="3 9" />
    </g>
  );
}

function Screw({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={5} fill="#cdc2ac" stroke={INK} strokeWidth={2} />
      <path d={`M${x - 2.6} ${y} H${x + 2.6} M${x} ${y - 2.6} V${y + 2.6}`} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
    </g>
  );
}

/**
 * Hand-drawn cassette: thick ink outlines with a slight wobble (SVG turbulence), screws, a handwritten sticker with the
 * song title, notched reels that turn while playing and a tape window that winds across the song. Every song gets its
 * own soothing colour scheme (seeded, weighted per station) and a slightly different "drawing" of the outline. The
 * "wear" knob scuffs it up: dust, scratches, a yellowed label, a coffee ring and finally chewed tape.
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
  const wear = useStore((s) => s.tape.vinyl);

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
    <svg className="cassette" viewBox="0 0 300 190" overflow="visible" role="img" aria-label={title ? `Now playing: ${title}` : 'Cassette'}>
      <defs>
        <filter id={sketch} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={sketchSeed(seed, song)} />
          {/* a worn tape is a shakier drawing */}
          <feDisplacementMap in="SourceGraphic" scale={2.4 + 2.2 * wear} />
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
            <path key={x} d={`M${x} 140 L${x + 48} 20`} stroke="#ffffff" strokeOpacity={0.1} strokeWidth={x % 120 === 0 ? 6 : 3} strokeLinecap="round" />
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

        <ChewedTape wear={wear} />

        {/* bottom guide with holes */}
        <path d="M66 184 L82 148 H218 L234 184" style={{ fill: c.body }} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        <path d="M66 184 L82 148 H218 L234 184" fill="#000" fillOpacity={0.08} />
        <circle cx={104} cy={170} r={5.5} fill="#d8ceb9" stroke={INK} strokeWidth={2} />
        <rect x={121} y={163} width={8} height={8} rx={1.5} fill="#d8ceb9" stroke={INK} strokeWidth={1.8} />
        <rect x={171} y={163} width={8} height={8} rx={1.5} fill="#d8ceb9" stroke={INK} strokeWidth={1.8} />
        <circle cx={196} cy={170} r={5.5} fill="#d8ceb9" stroke={INK} strokeWidth={2} />
        <Screw x={150} y={160} />

        <Screw x={18} y={18} />
        <Screw x={282} y={18} />
        <Screw x={18} y={172} />
        <Screw x={282} y={172} />

        <Wear wear={wear} seed={seed} />
      </g>
    </svg>
  );
}
