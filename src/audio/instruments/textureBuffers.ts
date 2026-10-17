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

/** Vinyl crackle: sparse clicks of random size (a few loud pops), over a faint dusty noise floor. */
export function crackleSamples(sampleRate: number, seconds: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const clicksPerSecond = 22;
  const p = clicksPerSecond / sampleRate;
  for (let i = 0; i < n; i++) {
    out[i]! += (rand() * 2 - 1) * 0.004;
    if (rand() < p) {
      const big = rand() < 0.06;
      const amp = (big ? 0.5 + rand() * 0.4 : Math.pow(rand(), 3) * 0.45) * (rand() < 0.5 ? -1 : 1);
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

/** Rain droplets: short, pitched, quickly decaying blips at random times. */
export function dropletSamples(sampleRate: number, seconds: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  const drops = Math.floor(seconds * 14);
  for (let d = 0; d < drops; d++) {
    const start = Math.floor(rand() * n);
    const hz = 1800 + rand() * 3800;
    const len = Math.floor(sampleRate * (0.006 + rand() * 0.02));
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

/** Fade both ends of a loop so the seam never clicks. */
function fadeEdges(data: Float32Array, len: number): void {
  for (let i = 0; i < len && i < data.length; i++) {
    const g = i / len;
    data[i]! *= g;
    data[data.length - 1 - i]! *= g;
  }
}
