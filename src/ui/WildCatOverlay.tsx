import { useEffect, useRef } from 'react';
import { currentExcursion, onExcursion, setCatAway, setCatNapping, type CatPlace, type Excursion } from '../services/wildcat';
import { CatSim, type CatPose } from './cat';

/**
 * The wild cat's trips around the page. The cat never flies freely across the screen: panels are zones, neighbouring
 * panels are connected, and the cat follows a route through them, hopping from panel edge to panel edge, walking
 * along the edge of the target panel and dropping onto the control it swats. Positions are resolved from live element
 * rects every frame, so scrolling and resizing are fine.
 */

type PointRef = { el: Element; fx: number; fy?: number; dy?: number };
type LegKind = 'hop' | 'walk' | 'pause';
interface Leg {
  kind: LegKind;
  from: PointRef;
  to: PointRef;
  ms: number;
  /** hop arc height multiplier */
  arc?: number;
}

/**
 * How this trip is travelled, read from the trip id: a trot or a saunter, high or flat hops, sometimes a detour
 * through a neighbouring panel, sometimes a stop to sit and look around. Same id, same route.
 */
interface Gait {
  speed: number;
  arc: number;
  detour: boolean;
  pauseChance: number;
  rand: () => number;
}

function gaitFor(id: number): Gait {
  let a = Math.imul(id, 0x9e3779b1) >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { speed: 0.7 + rand() * 0.75, arc: 0.6 + rand() * 1.1, detour: rand() < 0.35, pauseChance: rand() * 0.5, rand };
}

interface Trip {
  ex: Excursion;
  /** element swatted (jobs only) */
  target: Element | null;
  out: Leg[];
  back: Leg[];
  startAt: number;
  /** time scale applied to the outbound legs so the landing hits the downbeat */
  outScale: number;
  backStart: number;
  swatted: { start: boolean; end: boolean };
  /** cancelled: fade out and reappear in the scope */
  fadeFrom?: number;
}

const ADJ_GAP = 30;
const SWAT_MS = 450;
const CAT_SCALE = 1.25;

const rectOf = (el: Element): DOMRect => el.getBoundingClientRect();

function resolve(p: PointRef): { x: number; y: number } {
  const r = rectOf(p.el);
  return { x: r.left + p.fx * r.width, y: r.top + (p.fy ?? 0) * r.height + (p.dy ?? 0) };
}

function adjacent(a: DOMRect, b: DOMRect): boolean {
  return a.left - ADJ_GAP < b.right && b.left < a.right + ADJ_GAP && a.top - ADJ_GAP < b.bottom && b.top < a.bottom + ADJ_GAP;
}

/** Shortest route of zones from `from` to `to` (breadth-first over neighbouring panels). */
function route(zones: Element[], from: Element, to: Element): Element[] {
  const rects = new Map(zones.map((z) => [z, rectOf(z)]));
  const prev = new Map<Element, Element | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const z = queue.shift()!;
    if (z === to) break;
    for (const n of zones) {
      if (prev.has(n) || n === z) continue;
      if (adjacent(rects.get(z)!, rects.get(n)!)) {
        prev.set(n, z);
        queue.push(n);
      }
    }
  }
  if (!prev.has(to)) return [from, to];
  const path: Element[] = [];
  for (let z: Element | null = to; z; z = prev.get(z) ?? null) path.unshift(z);
  return path;
}

const clampFx = (fx: number): number => Math.min(0.94, Math.max(0.06, fx));

/** fx on zone `z` closest to the absolute x */
function fxToward(z: Element, x: number): number {
  const r = rectOf(z);
  return clampFx((x - r.left) / Math.max(1, r.width));
}

const dist = (a: PointRef, b: PointRef): number => {
  const p = resolve(a);
  const q = resolve(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

function leg(kind: LegKind, from: PointRef, to: PointRef, g?: Gait): Leg {
  const d = dist(from, to);
  const speed = g?.speed ?? 1;
  const ms = kind === 'walk' ? Math.min(1600, Math.max(120, (d / (300 * speed)) * 1000)) : Math.min(650, Math.max(300, 280 + d * 0.6));
  return { kind, from, to, ms, arc: g ? g.arc * (0.8 + g.rand() * 0.4) : 1 };
}

/** sit on the spot and look around for a moment */
function pause(at: PointRef, g: Gait): Leg {
  return { kind: 'pause', from: at, to: at, ms: 500 + g.rand() * 900 };
}

/** Where the cat sits at a place: in the scope (home) or on the pixel scene's windowsill. */
function placePoint(place: CatPlace): { zone: Element; point: PointRef } | null {
  if (place === 'window') {
    const scene = document.querySelector('.scene');
    const zone = document.querySelector('.main .hero');
    // the sill row of the pixel scene sits at 90% of its height; the cat sleeps right of the mullion
    return scene && zone ? { zone, point: { el: scene, fx: 0.66, fy: 0.9 } } : null;
  }
  const scope = document.querySelector('.chaos__scope');
  const zone = document.querySelector('.panel--chaos');
  return scope && zone ? { zone, point: { el: scope, fx: 0.4, fy: 1, dy: -6 } } : null;
}

/** A neighbouring zone of `z` that is neither end of the trip, for the occasional detour. */
function detourVia(zones: Element[], z: Element, avoid: Element, g: Gait): Element | null {
  const r = rectOf(z);
  const options = zones.filter((n) => n !== z && n !== avoid && adjacent(r, rectOf(n)));
  return options.length ? options[Math.floor(g.rand() * options.length)]! : null;
}

/** Legs from a point in one zone to a point in another, along zone edges (never straight across the page). */
function pathBetween(zones: Element[], fromZone: Element, from: PointRef, toZone: Element, to: PointRef, g: Gait): Leg[] {
  const legs: Leg[] = [];
  // up onto the edge of the zone we start in, landing somewhere along it (not always the nearest spot)
  let at: PointRef = { el: fromZone, fx: clampFx(fxToward(fromZone, resolve(from).x) + (g.rand() - 0.5) * 0.3) };
  legs.push(leg('hop', from, at, g));
  const via = g.detour ? detourVia(zones, fromZone, toZone, g) : null;
  const zonesOnRoute = via ? [...route(zones, fromZone, via), ...route(zones, via, toZone).slice(1)] : route(zones, fromZone, toZone);
  for (let i = 1; i < zonesOnRoute.length; i++) {
    const cur = zonesOnRoute[i - 1]!;
    const next = zonesOnRoute[i]!;
    const nr = rectOf(next);
    // walk along the current edge toward the next zone (aiming a bit off-centre), then hop across
    const edge: PointRef = { el: cur, fx: fxToward(cur, nr.left + nr.width * (0.3 + g.rand() * 0.4)) };
    if (Math.abs(edge.fx - at.fx) > 0.02) legs.push(leg('walk', at, edge, g));
    if (g.rand() < g.pauseChance) legs.push(pause(edge, g));
    const land: PointRef = { el: next, fx: fxToward(next, resolve(edge).x) };
    legs.push(leg('hop', edge, land, g));
    at = land;
  }
  // along the destination zone's edge, then down onto the spot
  const above: PointRef = { el: toZone, fx: fxToward(toZone, resolve(to).x) };
  if (Math.abs(above.fx - at.fx) > 0.02) legs.push(leg('walk', at, above, g));
  legs.push(leg('hop', above, to, g));
  return legs;
}

function buildTrip(ex: Excursion): Trip | null {
  const zones = Array.from(document.querySelectorAll('.main .panel, .main .hero'));
  const from = placePoint(ex.from);
  const to = placePoint(ex.to);
  if (!from || !to) return null;
  const now = performance.now();

  const g = gaitFor(ex.id);
  if (ex.kind !== 'job') {
    // a stroll to the window for a nap, or back home after one: no deadline, no swatting
    const out = pathBetween(zones, from.zone, from.point, to.zone, to.point, g);
    return { ex, target: null, out, back: [], startAt: now, outScale: 1, backStart: Infinity, swatted: { start: true, end: true } };
  }

  const target = ex.target ? document.querySelector(ex.target) : null;
  const targetZone = target?.closest('.panel');
  if (!target || !targetZone) return null;
  const onTarget: PointRef = { el: target, fx: 0.5 };
  const out = pathBetween(zones, from.zone, from.point, targetZone, onTarget, g);
  // the way back is its own trip: a different gait, maybe a different route
  const back = pathBetween(zones, targetZone, onTarget, to.zone, to.point, gaitFor(ex.id * 31 + 7));

  const travel = out.reduce((a, l) => a + l.ms, 0);
  const available = ex.landAt - now;
  const outScale = available >= travel ? 1 : Math.max(0.45, available / travel);
  return {
    ex,
    target,
    out,
    back,
    startAt: Math.max(now, ex.landAt - travel * outScale),
    outScale,
    backStart: ex.holdUntil + SWAT_MS,
    swatted: { start: false, end: false },
  };
}

/** Position + pose along a list of legs at time `t` since the legs began. */
function along(legs: Leg[], t: number, scale: number): { x: number; y: number; pose: CatPose; facing: number; walk: number } | null {
  let acc = 0;
  for (const l of legs) {
    const ms = l.ms * scale;
    if (t <= acc + ms) {
      const k = Math.min(1, Math.max(0, (t - acc) / ms));
      const a = resolve(l.from);
      const b = resolve(l.to);
      const facing = b.x >= a.x ? 1 : -1;
      if (l.kind === 'pause') {
        // sit and look around: one way, then the other
        return { x: a.x, y: a.y, pose: 'watch', facing: k < 0.5 ? 1 : -1, walk: 0 };
      }
      if (l.kind === 'walk') return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, pose: 'stalk', facing, walk: (t / 1000) * 8 };
      const h = Math.max(30, Math.abs(b.y - a.y) * 0.35 + 24) * (l.arc ?? 1);
      const y = a.y + (b.y - a.y) * k - h * 4 * k * (1 - k);
      return { x: a.x + (b.x - a.x) * k, y, pose: 'air', facing, walk: 0 };
    }
    acc += ms;
  }
  return null;
}

function swat(el: Element): void {
  el.classList.remove('cat-swat');
  void (el as HTMLElement).offsetWidth; // restart the animation
  el.classList.add('cat-swat');
  setTimeout(() => el.classList.remove('cat-swat'), 500);
}

/** The knob twists back and forth under the cat's paws, one swing per 16th, for as long as the acid runs. */
function startWiggle(el: Element, stepMs: number): void {
  (el as HTMLElement).style.setProperty('--wiggle-ms', `${Math.round(stepMs)}ms`);
  el.classList.add('cat-wiggle');
}

function stopWiggle(el: Element): void {
  el.classList.remove('cat-wiggle');
}

/**
 * The cat working the knob during acid: a bounce and a paw push on every 16th, a bigger one with a wind-up on accents,
 * swaying side to side and turning round on every beat.
 */
function wigglePose(sinceLand: number, w: NonNullable<Excursion['wiggle']>): { dx: number; dy: number; pose: CatPose; facing: number } {
  const step = Math.floor(sinceLand / w.stepMs);
  const k = (sinceLand % w.stepMs) / w.stepMs;
  const accent = w.accents.length > 0 && !!w.accents[step % w.accents.length];
  const side = step % 2 === 0 ? -1 : 1;
  const push = Math.sin(Math.PI * k);
  return {
    dx: side * (accent ? 7 : 4) * (1 - k),
    dy: -(accent ? 9 : 4) * push,
    pose: accent ? (k < 0.35 ? 'windup' : 'air') : k < 0.5 ? 'air' : 'watch',
    facing: Math.floor(step / 4) % 2 === 0 ? 1 : -1,
  };
}

function bubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '600 17px Caveat, "Comic Sans MS", cursive';
  const w = ctx.measureText(text).width + 16;
  const bx = Math.round(x - w / 2);
  const by = Math.round(y - 58);
  ctx.fillStyle = '#efe4cc';
  ctx.strokeStyle = '#1d1713';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, 24, 8);
  ctx.moveTo(x - 5, by + 24);
  ctx.lineTo(x, by + 31);
  ctx.lineTo(x + 5, by + 24);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2a1f17';
  ctx.fillText(text, bx + 8, by + 17);
  ctx.restore();
}

export function WildCatOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const cat = new CatSim(11);
    let trip: Trip | null = null;
    /** the cat is asleep on the windowsill (drawn by the pixel scene, not here) */
    let asleep = false;
    let raf = 0;

    /** a trip ended at its destination */
    const arrive = (tr: Trip): void => {
      trip = null;
      asleep = tr.ex.to === 'window';
      setCatNapping(asleep);
      setCatAway(asleep);
    };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const unsub = onExcursion((ex) => {
      if (ex) {
        if (trip?.target) stopWiggle(trip.target);
        trip = buildTrip(ex);
        if (trip) {
          // leaving the windowsill: the pixel scene stops drawing it
          asleep = false;
          setCatNapping(false);
        }
      } else if (trip && !trip.fadeFrom) {
        trip.fadeFrom = performance.now();
        if (trip.target) stopWiggle(trip.target);
      }
    });
    const pending = currentExcursion();
    if (pending) trip = buildTrip(pending);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (!trip || now < trip.startAt) {
        setCatAway(asleep);
        return;
      }
      const tr = trip;
      const t = now / 1000;
      let alpha = 1;
      if (tr.fadeFrom) {
        alpha = 1 - (now - tr.fadeFrom) / 300;
        if (alpha <= 0) {
          trip = null;
          asleep = false;
          setCatNapping(false);
          setCatAway(false);
          return;
        }
      }
      setCatAway(true);
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);

      let p: { x: number; y: number; pose: CatPose; facing: number; walk: number } | null = null;
      if (!tr.target) {
        // a stroll (to or from the window)
        p = along(tr.out, now - tr.startAt, 1);
        if (!p) {
          arrive(tr);
          ctx.restore();
          return;
        }
      } else if (now < tr.ex.landAt) {
        p = along(tr.out, now - tr.startAt, tr.outScale) ?? along(tr.out, Number.MAX_SAFE_INTEGER, 1);
      } else if (now < tr.backStart) {
        // on the control: swat on landing, sit and watch, swat again to undo
        if (!tr.swatted.start) {
          tr.swatted.start = true;
          if (tr.ex.wiggle) startWiggle(tr.target, tr.ex.wiggle.stepMs);
          else swat(tr.target);
        }
        if (now >= tr.ex.holdUntil && !tr.swatted.end && tr.ex.endLabel) {
          tr.swatted.end = true;
          swat(tr.target);
        }
        const r = rectOf(tr.target);
        const sinceLand = now - tr.ex.landAt;
        const sinceEnd = now - tr.ex.holdUntil;
        const swatting = sinceLand < SWAT_MS || (tr.ex.endLabel && sinceEnd >= 0 && sinceEnd < SWAT_MS);
        const phase = sinceEnd >= 0 ? sinceEnd : sinceLand;
        if (tr.ex.doze && !swatting && now < tr.ex.holdUntil) {
          // a proud moment, then it curls up on the fader and sleeps until the layer comes back
          const pose: CatPose = sinceLand < 1400 ? 'proud' : 'sleep';
          p = { x: r.left + r.width / 2, y: r.top, pose, facing: 1, walk: 0 };
        } else if (tr.ex.wiggle && now < tr.ex.holdUntil) {
          const w = wigglePose(sinceLand, tr.ex.wiggle);
          p = { x: r.left + r.width / 2 + w.dx, y: r.top + w.dy, pose: w.pose, facing: w.facing, walk: 0 };
        } else {
          if (tr.ex.wiggle && tr.swatted.start) stopWiggle(tr.target);
          const pose: CatPose = swatting ? (phase % SWAT_MS < 200 ? 'windup' : 'air') : sinceLand < 1400 ? 'proud' : 'watch';
          p = { x: r.left + r.width / 2, y: r.top, pose, facing: 1, walk: 0 };
        }
      } else {
        p = along(tr.back, now - tr.backStart, 1);
        if (!p) {
          arrive(tr);
          ctx.restore();
          return;
        }
      }
      if (p) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(CAT_SCALE, CAT_SCALE);
        cat.drawPose(ctx, 0, 0, p.pose, p.facing, t, p.walk);
        ctx.restore();
        const sinceLand = now - tr.ex.landAt;
        const sinceEnd = now - tr.ex.holdUntil;
        if (tr.ex.label && tr.target && sinceLand >= 0 && sinceLand < 1500) bubble(ctx, p.x, p.y, tr.ex.label, Math.min(1, (1500 - sinceLand) / 300));
        else if (tr.ex.endLabel && tr.target && sinceEnd >= 0 && sinceEnd < 1200) bubble(ctx, p.x, p.y, tr.ex.endLabel, Math.min(1, (1200 - sinceEnd) / 300));
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      if (trip?.target) stopWiggle(trip.target);
      window.removeEventListener('resize', resize);
      setCatAway(false);
      setCatNapping(false);
    };
  }, []);

  return <canvas ref={ref} className="wildcat" aria-hidden="true" />;
}
