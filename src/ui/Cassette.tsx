import { useStore } from '../services/store';

/** Bars over which the tape visibly winds from the left reel to the right one. */
const WIND_BARS = 64;

function Reel({ cx, pack, spinning }: { cx: number; pack: number; spinning: boolean }) {
  return (
    <g>
      <circle cx={cx} cy={52} r={9.5 + pack * 6.5} className="cassette__pack" />
      <g className={`cassette__reel${spinning ? ' is-spinning' : ''}`} style={{ transformOrigin: `${cx}px 52px` }}>
        <circle cx={cx} cy={52} r={9} className="cassette__hub" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <rect key={a} x={cx - 1.2} y={44} width={2.4} height={5} rx={1} className="cassette__tooth" transform={`rotate(${a} ${cx} 52)`} />
        ))}
      </g>
    </g>
  );
}

/** Cassette with the current song on its label; reels turn while playing and the tape winds across the song. */
export function Cassette() {
  const playing = useStore((s) => s.playing);
  const title = useStore((s) => s.now.songTitle);
  const songIndex = useStore((s) => s.now.songIndex);
  const bar = useStore((s) => s.now.bar);
  const start = useStore((s) => s.now.songStartBar);
  const busy = useStore((s) => s.busy);
  const progress = Math.min(1, Math.max(0, (bar - start) / WIND_BARS));
  const side = songIndex >= 0 ? (songIndex % 2 === 0 ? 'A' : 'B') : 'A';

  return (
    <svg className="cassette" viewBox="0 0 200 120" role="img" aria-label={title ? `Now playing: ${title}` : 'Cassette'}>
      <rect x={2} y={2} width={196} height={116} rx={9} className="cassette__body" />
      <rect x={14} y={10} width={172} height={30} rx={3} className="cassette__label" />
      <rect x={14} y={10} width={172} height={6} className="cassette__stripe" />
      <text x={22} y={33} className="cassette__title">
        {busy ? 'rewinding...' : title || 'night tape'}
      </text>
      <text x={178} y={33} className="cassette__side" textAnchor="end">
        {side}
      </text>
      <rect x={44} y={36} width={112} height={36} rx={14} className="cassette__window" />
      <Reel cx={70} pack={1 - progress} spinning={playing && !busy} />
      <Reel cx={130} pack={progress} spinning={playing && !busy} />
      <path d="M40 116 L52 92 H148 L160 116" className="cassette__bridge" />
      {[64, 84, 116, 136].map((x) => (
        <circle key={x} cx={x} cy={104} r={3} className="cassette__hole" />
      ))}
    </svg>
  );
}
