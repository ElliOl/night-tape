/**
 * Pure sample generators for the ambience loops (no Tone / AudioContext), deterministic per seed.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dust crackle: clicks of random size (a few loud pops), over a faint dusty noise floor. */
export function crackleSamples(sampleRate: number, seconds: number, seed: number, clicksPerSecond = 22): Float32Array {
  const rand = mulberry32(seed);
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const p = clicksPerSecond / sampleRate;
  for (let i = 0; i < n; i++) {
    out[i]! += (rand() * 2 - 1) * 0.004;
    if (rand() < p) {
      const big = rand() < 0.06;
      const amp = (big ? 0.5 + rand() * 0.4 : (0.04 + Math.pow(rand(), 2) * 0.5)) * (rand() < 0.5 ? -1 : 1);
      const len = big ? 20 + Math.floor(rand() * 60) : 2 + Math.floor(rand() * 10);
      for (let k = 0; k < len && i + k < n; k++) {
        // decaying, slightly ringing impulse
        out[i + k]! += amp * Math.exp(-k / (len * 0.3)) * (k % 2 === 0 ? 1 : -0.6);
      }
    }
  }
  fadeEdges(out, Math.floor(sampleRate * 0.01));
  return out;
}

export interface DropletOptions {
  /** drops per second */
  rate: number;
  /** pitch range of a drop (Hz) */
  loHz: number;
  hiHz: number;
  /** drop length range (s) */
  minLen: number;
  maxLen: number;
}

/** Rain droplets: short, pitched, quickly decaying blips at random times. */
export function dropletSamples(
  sampleRate: number,
  seconds: number,
  seed: number,
  o: DropletOptions = { rate: 14, loHz: 1800, hiHz: 5600, minLen: 0.006, maxLen: 0.026 },
): Float32Array {
  const rand = mulberry32(seed);
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const drops = Math.floor(seconds * o.rate);
  for (let d = 0; d < drops; d++) {
    const start = Math.floor(rand() * n);
    const hz = o.loHz + rand() * (o.hiHz - o.loHz);
    const len = Math.floor(sampleRate * (o.minLen + rand() * (o.maxLen - o.minLen)));
    const amp = Math.pow(rand(), 2) * 0.5 + 0.05;
    for (let k = 0; k < len && start + k < n; k++) {
      const env = Math.exp((-6 * k) / len);
      // pitch falls a little like a real drop
      const phase = (2 * Math.PI * hz * k * (1 - (0.25 * k) / len)) / sampleRate;
      out[start + k]! += amp * env * Math.sin(phase);
    }
  }
  fadeEdges(out, Math.floor(sampleRate * 0.01));
  return out;
}

/**
 * Tape dropout envelope 0..1 (1 = the worn spot fully over the head): a few smooth dips of 40..300 ms, some short
 * flutters in clusters. Used as a control signal on the master, scaled by the wear knob.
 */
export function dropoutSamples(sampleRate: number, seconds: number, seed: number, perSecond = 0.45): Float32Array {
  const rand = mulberry32(seed);
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const events = Math.max(1, Math.round(seconds * perSecond));
  for (let e = 0; e < events; e++) {
    const cluster = rand() < 0.3 ? 2 + Math.floor(rand() * 3) : 1;
    let start = Math.floor(rand() * n);
    for (let c = 0; c < cluster; c++) {
      const len = Math.floor(sampleRate * (cluster > 1 ? 0.03 + rand() * 0.05 : 0.04 + rand() * 0.26));
      const depth = 0.35 + rand() * 0.65;
      for (let k = 0; k < len; k++) {
        const i = (start + k) % n;
        // raised-cosine dip: no clicks in or out
        const v = depth * 0.5 * (1 - Math.cos((2 * Math.PI * k) / len));
        if (v > out[i]!) out[i] = v;
      }
      start += len + Math.floor(sampleRate * (0.02 + rand() * 0.06));
    }
  }
  return out;
}

/** Fade both ends of a loop so the seam never clicks. */
function fadeEdges(data: Float32Array, len: number): void {
  for (let i = 0; i < len && i < data.length; i++) {
    const g = i / len;
    data[i]! *= g;
    data[data.length - 1 - i]! *= g;
  }
}
