import { useEffect, useRef } from 'react';
import {
  catWindowSpot, currentExcursion, onExcursion, setCatAway, setCatNapping, setPlayerControl, setWindowSpot, type CatPlace, type Excursion,
} from '../services/wildcat';
import { CROSSBAR_ROW, SILL_ROW, sceneRows } from './sceneGeometry';
import { CatSim, type CatPose } from './cat';
import { CatPlayer, readPad } from './catPlayer';
import { FloorMouse } from './mouse';
import { mouseMischief } from './mouseMischief';
import { BUBBLE_FONT, SAY } from './speech';
import { shedCrumbs } from './crumbSources';
import { useStore } from '../services/store';

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
  /** speech bubbles at times since startAt (ms) */
  say?: Array<{ at: number; ms: number; text: string }>;
}

const ADJ_GAP = 30;
/** the levels of the page the cat travels along */
const ZONE_SEL = '.main .panel, .main .hero, .floor__ground';
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

/**
 * The level the cat is on (or in, when it stands on a control inside a panel) at viewport point x, y, as a point that
 * moves with the page. Used so every trip starts exactly where the cat is: it never vanishes from a level.
 */
function zoneUnder(x: number, y: number): { zone: Element; point: PointRef } | null {
  let best: Element | null = null;
  let bestScore = Infinity;
  for (const z of document.querySelectorAll(ZONE_SEL)) {
    const r = rectOf(z);
    if (x < r.left - 4 || x > r.right + 4) continue;
    const below = y - r.top; // >= 0: feet on or below the top edge (on it, or on a control inside it)
    const inside = below >= -4 && y <= r.bottom + 4;
    const score = inside ? Math.max(0, below) : 10000 + Math.abs(below);
    if (score < bestScore) {
      bestScore = score;
      best = z;
    }
  }
  if (!best) return null;
  const r = rectOf(best);
  return { zone: best, point: { el: best, fx: Math.min(1, Math.max(0, (x - r.left) / Math.max(1, r.width))), dy: y - r.top } };
}

/** Where the cat sits at a place: in the scope (home) or on the pixel scene's windowsill. */
function placePoint(place: CatPlace): { zone: Element; point: PointRef } | null {
  if (place === 'window') {
    const scene = document.querySelector('.scene');
    const zone = document.querySelector('.main .hero');
    if (!scene || !zone) return null;
    if (catWindowSpot() === 'bar') {
      // up on the middle crossbar, left of the mullion (same pixel row the scene draws the bar on)
      const rows = sceneRows(rectOf(scene).height);
      return { zone, point: { el: scene, fx: 0.28, fy: Math.round(rows * CROSSBAR_ROW) / rows } };
    }
    // the sill row of the pixel scene sits at 90% of its height; the cat sleeps right of the mullion
    return { zone, point: { el: scene, fx: 0.66, fy: SILL_ROW } };
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

function buildTrip(ex: Excursion, start: { zone: Element; point: PointRef } | null): Trip | null {
  const zones = Array.from(document.querySelectorAll(ZONE_SEL));
  const from = start ?? placePoint(ex.from);
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
  ctx.font = BUBBLE_FONT;
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

let strollId = 1_000_000;

/** Floor zone (the lowest level of the page) and a point on it at viewport x. */
function floorAt(x: number): { zone: Element; point: PointRef } | null {
  const zone = document.querySelector('.floor__ground');
  return zone ? { zone, point: { el: zone, fx: fxToward(zone, x) } } : null;
}

/**
 * The cat spots the mouse: down to the floor a little way off, a dash and a pounce at where the mouse was (it is
 * always gone by then: it runs faster than the cat), a long sulk, then home.
 */
function chaseTrip(mouseX: number, now: number, start: { zone: Element; point: PointRef } | null): Trip | null {
  const home = placePoint('home');
  const origin = start ?? home;
  const zones = Array.from(document.querySelectorAll(ZONE_SEL));
  const floor = document.querySelector('.floor__ground')?.getBoundingClientRect();
  if (!floor) return null;
  // land on whichever side has more room, a cautious distance from the mouse
  const fromLeft = mouseX - floor.left > floor.right - mouseX;
  const land = floorAt(mouseX + (fromLeft ? -200 : 200));
  const hole = floorAt(mouseX);
  if (!home || !origin || !land || !hole) return null;
  const ex: Excursion = { id: strollId++, kind: 'wake', from: 'home', to: 'home', landAt: now, holdUntil: now };
  const g = gaitFor(ex.id);
  const toFloor = pathBetween(zones, origin.zone, origin.point, land.zone, land.point, g);
  const dashMs = Math.max(250, (dist(land.point, hole.point) / 650) * 1000);
  const legs: Leg[] = [
    ...toFloor,
    { kind: 'walk', from: land.point, to: hole.point, ms: dashMs },
    { kind: 'hop', from: hole.point, to: hole.point, ms: 380, arc: 0.6 },
    { kind: 'pause', from: hole.point, to: hole.point, ms: 2600 },
  ];
  const back = pathBetween(zones, hole.zone, hole.point, home.zone, home.point, gaitFor(ex.id * 31 + 7));
  const arrive = toFloor.reduce((a, l) => a + l.ms, 0);
  const atHole = arrive + dashMs + 380;
  return {
    ex,
    target: null,
    out: [...legs, ...back],
    back: [],
    startAt: now,
    outScale: 1,
    backStart: Infinity,
    swatted: { start: true, end: true },
    say: [
      { at: Math.max(0, arrive - 600), ms: 900, text: SAY.spotted },
      { at: atHole + 300, ms: 1700, text: SAY.missed[ex.id % SAY.missed.length]! },
    ],
  };
}

/** A stroll home from wherever the cat is (a point on a level, see zoneUnder). */
function walkHome(at: { zone: Element; point: PointRef }, now: number): Trip | null {
  const home = placePoint('home');
  if (!home) return null;
  const zones = Array.from(document.querySelectorAll(ZONE_SEL));
  const ex: Excursion = { id: strollId++, kind: 'wake', from: 'home', to: 'home', landAt: now, holdUntil: now };
  const out = pathBetween(zones, at.zone, at.point, home.zone, home.point, gaitFor(ex.id));
  return { ex, target: null, out, back: [], startAt: now, outScale: 1, backStart: Infinity, swatted: { start: true, end: true } };
}

export function WildCatOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const cat = new CatSim(11);
    const player = new CatPlayer();
    let lastFrame = performance.now();
    /** Select held last frame (the nap toggles on the press) */
    let padSleepHeld = false;
    const mouse = new FloorMouse();
    /** when the idle cat next fancies a go at the mouse */
    let nextChaseAt = performance.now() + 30000 + Math.random() * 40000;
    /** the cat's feet this frame (viewport), so the mouse knows to run (or that it is safe: asleep) */
    let catAt: { x: number; y: number; asleep?: boolean } | null = null;
    /** what the mouse just said, shown over its head */
    let mouseSays: { text: string; until: number } | null = null;
    let trip: Trip | null = null;
    /** the cat is asleep on the windowsill (drawn by the pixel scene, not here) */
    let asleep = false;
    /** where the cat is while it is out of the scope (moves with the page); null = at home in the scope */
    let anchor: { zone: Element; point: PointRef } | null = null;
    /** where the next trip starts: where the cat is right now */
    const origin = (): { zone: Element; point: PointRef } | null =>
      anchor ?? (asleep ? placePoint('window') : placePoint('home'));
    /** the cat was drawn at viewport x, y this frame */
    const at = (x: number, y: number): void => {
      anchor = zoneUnder(x, y);
      catAt = { x, y };
    };
    /** asleep on the spot (Z / Select): where, whether that is home in the scope, and whether you were steering it */
    let sleepSpot: { zone: Element; point: PointRef } | null = null;
    let sleepAtHome = false;
    let sleptWhileSteering = false;
    let raf = 0;

    /** a trip ended at its destination */
    const arrive = (tr: Trip): void => {
      trip = null;
      anchor = null;
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
      if (player.active) return; // the player has the cat
      if (trip?.target) stopWiggle(trip.target);
      if (ex) {
        // off to the window: half the time to sit up on the crossbar, half to sleep on the sill
        if (ex.to === 'window') setWindowSpot(Math.random() < 0.5 ? 'bar' : 'sill');
        trip = buildTrip(ex, origin());
        if (trip) {
          // leaving the windowsill: the pixel scene stops drawing it
          asleep = false;
          setCatNapping(false);
        }
      } else if (trip) {
        // the job was called off: the cat walks home from where it is (it never just vanishes), unless it was
        // called off because the cat is going to sleep right there
        trip = anchor && !useStore.getState().catSleep ? walkHome(anchor, performance.now()) : null;
      }
    });
    const pending = currentExcursion();
    if (pending) trip = buildTrip(pending, origin());

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;

      // ---- the mouse: always about on the floor, runs from any cat; now and then the idle cat goes after it
      // settings turned up high shed crumbs that fall down the page to the mouse's floor
      for (const c of shedCrumbs(now)) mouse.dropCrumb(c.x, c.y);
      const mouseEvent = mouse.update(now, dt, catAt ? [catAt] : []);
      if (mouseEvent?.mischief) mouseSays = { text: mouseMischief(), until: now + 1800 };
      else if (mouseEvent?.say) mouseSays = { text: mouseEvent.say, until: now + 1600 };
      catAt = null;
      if (now >= nextChaseAt) {
        nextChaseAt = now + 40000 + Math.random() * 60000;
        const m = mouse.position();
        if (m && !player.active && !trip && !asleep) {
          trip = chaseTrip(m.x, now, origin());
          if (trip) setCatAway(true);
        }
      }
      mouse.draw(ctx, now);
      if (mouseSays && now < mouseSays.until) {
        const m = mouse.position();
        // well clear of the mouse (and its hops): the box sits ~45 px above its feet
        if (m) bubble(ctx, m.x, m.y - 10, mouseSays.text, Math.min(1, (mouseSays.until - now) / 300));
      }

      // ---- gamepad: any input takes the cat; Start / Select, or a few seconds without input, hands it back
      const pad = readPad();
      // Select toggles the nap (like Z), without picking the cat up
      if (pad?.sleep && !padSleepHeld) {
        const st = useStore.getState();
        st.setCatSleep(!st.catSleep);
      }
      padSleepHeld = !!pad?.sleep;
      // a sleeping cat is not picked up: only Select / Z wakes it
      if (!player.active && pad?.any && !useStore.getState().catSleep) {
        // the player picks the cat up exactly where it is: in the scope, on the sill, or out on a level
        const o = origin();
        const sp = o ? resolve(o.point) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        if (trip?.target) stopWiggle(trip.target);
        setPlayerControl(true);
        trip = null;
        asleep = false;
        setCatNapping(false);
        player.start(sp.x, sp.y, now);
      }
      const sleepy = useStore.getState().catSleep;
      if (player.active && sleepy && player.grounded) {
        // Select / Z while you steer: it curls up right here (once it has landed)
        sleepSpot = anchor;
        sleepAtHome = false;
        sleptWhileSteering = true;
        player.stop();
        setPlayerControl(false);
      }
      if (player.active) {
        // going to sleep mid-jump: no more steering, just land
        const input = sleepy ? { x: 0, y: 0, turn: 0, jump: false, paw: false, home: false, sleep: false, any: true } : pad;
        const f = input ? player.update(dt, input, now) : null;
        if (!f) {
          // back to its own life: stroll home from wherever it is
          player.stop();
          setPlayerControl(false);
          trip = anchor ? walkHome(anchor, now) : null;
          if (!trip) {
            anchor = null;
            setCatAway(false);
          }
          return;
        }
        setCatAway(true);
        at(f.x, f.y);
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.scale(CAT_SCALE, CAT_SCALE);
        cat.drawPose(ctx, 0, 0, f.pose, f.facing, now / 1000, f.walk);
        ctx.restore();
        if (f.label) bubble(ctx, f.x, f.y, f.label, 1);
        return;
      }
      // ---- asleep on the spot (Z / Select)
      if (sleepy && !sleepSpot && !asleep) {
        if (trip?.target) stopWiggle(trip.target);
        trip = null;
        sleepAtHome = !anchor;
        sleepSpot = anchor ?? placePoint('home');
        sleptWhileSteering = false;
      }
      if (sleepSpot && !sleepy) {
        // woken: carry on steering if you were, otherwise its usual life from there
        const spot = sleepSpot;
        sleepSpot = null;
        if (sleptWhileSteering && pad) {
          const p = resolve(spot.point);
          setPlayerControl(true);
          player.start(p.x, p.y, now, SAY.yawn);
        } else if (sleepAtHome) {
          anchor = null;
          setCatAway(false);
        } else {
          trip = walkHome(spot, now);
        }
        return;
      }
      if (sleepSpot) {
        const s = resolve(sleepSpot.point);
        setCatAway(true);
        if (!sleepAtHome) at(s.x, s.y);
        catAt = { x: s.x, y: s.y, asleep: true };
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.scale(CAT_SCALE, CAT_SCALE);
        cat.drawPose(ctx, 0, 0, 'sleep', 1, now / 1000, 0);
        ctx.restore();
        // a z drifting up
        const k = (now / 2200) % 1;
        ctx.save();
        ctx.globalAlpha = 0.85 * (1 - k);
        ctx.fillStyle = '#e8dfc8';
        ctx.font = '600 13px Caveat, "Comic Sans MS", cursive';
        ctx.fillText('z', s.x + 12 + k * 10, s.y - 22 - k * 24);
        ctx.restore();
        return;
      }
      if (!trip || now < trip.startAt) {
        if (anchor) {
          // out on a level, waiting to set off: sit there and watch
          const w = resolve(anchor.point);
          setCatAway(true);
          ctx.save();
          ctx.translate(w.x, w.y);
          ctx.scale(CAT_SCALE, CAT_SCALE);
          cat.drawPose(ctx, 0, 0, 'watch', 1, now / 1000, 0);
          ctx.restore();
          catAt = w;
          return;
        }
        setCatAway(asleep);
        return;
      }
      const tr = trip;
      const t = now / 1000;
      setCatAway(true);
      ctx.save();

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
        at(p.x, p.y);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(CAT_SCALE, CAT_SCALE);
        cat.drawPose(ctx, 0, 0, p.pose, p.facing, t, p.walk);
        ctx.restore();
        const sinceLand = now - tr.ex.landAt;
        const sinceEnd = now - tr.ex.holdUntil;
        const line = tr.say?.find((s) => now - tr.startAt >= s.at && now - tr.startAt < s.at + s.ms);
        if (line) bubble(ctx, p.x, p.y, line.text, Math.min(1, (line.at + line.ms - (now - tr.startAt)) / 300));
        else if (tr.ex.label && tr.target && sinceLand >= 0 && sinceLand < 1500) bubble(ctx, p.x, p.y, tr.ex.label, Math.min(1, (1500 - sinceLand) / 300));
        else if (tr.ex.endLabel && tr.target && sinceEnd >= 0 && sinceEnd < 1200) bubble(ctx, p.x, p.y, tr.ex.endLabel, Math.min(1, (1200 - sinceEnd) / 300));
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      if (player.active) setPlayerControl(false);
      if (trip?.target) stopWiggle(trip.target);
      window.removeEventListener('resize', resize);
      setCatAway(false);
      setCatNapping(false);
    };
  }, []);

  return <canvas ref={ref} className="wildcat" aria-hidden="true" />;
}
