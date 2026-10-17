/**
 * A small ginger cat that hunts the chaos LFO's red dot inside the scope canvas.
 * Behaviour: stalks along the floor under the dot, wiggles and pounces when the dot dips low enough, sits proudly
 * after a catch, watches (tail swishing) when the dot is out of reach, and curls up asleep when nothing is moving.
 */

type CatState = 'stalk' | 'windup' | 'air' | 'land' | 'proud' | 'watch' | 'sleep';

const GRAVITY = 900; // px/s²
const POUNCE_TIME = 0.45; // s of flight aimed at the dot
const BODY = '#c98a4b';
const STRIPE = '#9a5f2c';
const BELLY = '#e8c9a0';

export interface Bounds {
  w: number;
  h: number;
}

export class CatSim {
  x = 30;
  y = 0; // height above the floor (px, up is positive)
  private vx = 0;
  private vy = 0;
  private state: CatState = 'sleep';
  private timer = 0;
  private facing = 1;
  private walk = 0;
  private time = 0;
  private catches = 0;
  private sparkle = 0;
  private lookX = 0;
  private lookY = -1;
  private rand: () => number;

  constructor(seed = 9) {
    let a = seed >>> 0;
    this.rand = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  get caught(): number {
    return this.catches;
  }

  /** `dot` in canvas coords (y down), or null when there is nothing to chase. */
  update(dt: number, dot: { x: number; y: number } | null, b: Bounds): void {
    this.time += dt;
    this.timer -= dt;
    this.sparkle = Math.max(0, this.sparkle - dt);
    const floor = b.h - 6;

    if (!dot) {
      if (this.state !== 'air') {
        this.state = 'sleep';
        this.vx = 0;
      }
    } else if (this.state === 'sleep') {
      this.state = 'stalk'; // wakes up the moment the dot moves
    }

    if (dot) {
      // eyes follow the dot
      const hx = this.x + this.facing * 12;
      const hy = floor - this.y - 14;
      const d = Math.hypot(dot.x - hx, dot.y - hy) || 1;
      this.lookX = (dot.x - hx) / d;
      this.lookY = (dot.y - hy) / d;
    }

    const dx = dot ? dot.x - this.x : 0;
    const dotHeight = dot ? floor - dot.y : 0; // how high the dot is above the floor
    const reachable = dotHeight < b.h * 0.62;

    switch (this.state) {
      case 'stalk':
      case 'watch': {
        if (!dot) break;
        this.facing = dx >= 0 ? 1 : -1;
        const gap = Math.abs(dx) - 26;
        const speed = gap > 80 ? 130 : 55;
        const want = gap > 0 ? Math.sign(dx) * speed : 0;
        this.vx += (want - this.vx) * Math.min(1, dt * 6);
        this.x += this.vx * dt;
        this.walk += Math.abs(this.vx) * dt * 0.25;
        this.state = reachable ? 'stalk' : 'watch';
        // close and low enough: get ready to pounce (sometimes it tries for a high one anyway)
        if (gap < 30 && (reachable || this.rand() < dt * 0.4)) {
          this.state = 'windup';
          this.timer = 0.35 + this.rand() * 0.4;
          this.vx = 0;
        }
        break;
      }
      case 'windup':
        if (dot) this.facing = dx >= 0 ? 1 : -1;
        if (this.timer <= 0 && dot) {
          // aim where the dot is (with a little error: it is a cat)
          const tx = dot.x + (this.rand() - 0.5) * 18;
          const ty = Math.min(b.h * 0.95, dotHeight + (this.rand() - 0.5) * 14);
          this.vx = (tx - this.x - this.facing * 12) / POUNCE_TIME;
          this.vy = (ty - 12 + 0.5 * GRAVITY * POUNCE_TIME * POUNCE_TIME) / POUNCE_TIME;
          this.vy = Math.min(this.vy, 520);
          this.state = 'air';
        }
        break;
      case 'air': {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vy -= GRAVITY * dt;
        if (dot) {
          const pawX = this.x + this.facing * 14;
          const pawY = floor - this.y - 12;
          if (Math.hypot(dot.x - pawX, dot.y - pawY) < 13) {
            this.catches++;
            this.sparkle = 0.6;
            this.vx *= 0.3;
          }
        }
        if (this.y <= 0) {
          this.y = 0;
          this.vy = 0;
          this.vx = 0;
          this.state = this.sparkle > 0 ? 'proud' : 'land';
          this.timer = this.state === 'proud' ? 1.3 : 0.3;
        }
        break;
      }
      case 'land':
      case 'proud':
        if (this.timer <= 0) this.state = dot ? 'stalk' : 'sleep';
        break;
      case 'sleep':
        break;
    }
    this.x = Math.min(b.w - 16, Math.max(16, this.x));
  }

  draw(ctx: CanvasRenderingContext2D, b: Bounds): void {
    const floor = b.h - 6;
    ctx.save();
    ctx.translate(this.x, floor - this.y);
    if (this.state === 'sleep') {
      this.drawSleeping(ctx);
      ctx.restore();
      return;
    }
    ctx.scale(this.facing, 1);
    const t = this.time;
    const crouch = this.state === 'windup' ? 1 : this.state === 'land' ? 0.6 : 0;
    const airborne = this.state === 'air';
    const proud = this.state === 'proud';
    const wiggle = this.state === 'windup' ? Math.sin(t * 40) * 1.5 : 0;

    // tail
    const swish = this.state === 'watch' ? Math.sin(t * 5) * 0.9 : this.state === 'windup' ? Math.sin(t * 22) * 0.5 : Math.sin(t * 2) * 0.35;
    ctx.strokeStyle = BODY;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-10 + wiggle, -9 + crouch * 3);
    ctx.quadraticCurveTo(-20 + wiggle, -12 + swish * 6, -18 + wiggle + swish * 6, airborne ? -12 : proud ? -26 : -21 + crouch * 6);
    ctx.stroke();

    // legs (walk cycle on the ground, stretched in the air)
    ctx.strokeStyle = BODY;
    ctx.lineWidth = 2.6;
    const legs: Array<[number, number]> = [[-7, 0], [-3, Math.PI], [5, Math.PI], [9, 0]];
    for (const [lx, phase] of legs) {
      const step = this.state === 'stalk' || this.state === 'watch' ? Math.sin(this.walk * 6 + phase) * 2.5 : 0;
      const reach = airborne ? (lx > 0 ? 4 : -4) : 0;
      ctx.beginPath();
      ctx.moveTo(lx + wiggle * 0.3, -6 + crouch * 2);
      ctx.lineTo(lx + step + reach, airborne ? 1 : 0);
      ctx.stroke();
    }

    // body
    const bodyY = -9 + crouch * 3;
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(wiggle * 0.5, bodyY, airborne ? 13 : 11, airborne ? 5 : 6 - crouch, airborne ? -0.25 : 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = BELLY;
    ctx.beginPath();
    ctx.ellipse(wiggle * 0.5 + 1, bodyY + 3, 7, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = STRIPE;
    ctx.lineWidth = 1.4;
    for (const sx of [-6, -2, 2]) {
      ctx.beginPath();
      ctx.moveTo(sx + wiggle * 0.5, bodyY - 5 + crouch);
      ctx.lineTo(sx + 1.5 + wiggle * 0.5, bodyY - 1.5);
      ctx.stroke();
    }

    // head
    const hx = 12;
    const hy = (airborne ? -15 : proud ? -18 : -14) + crouch * 4;
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.arc(hx, hy, 5.6, 0, Math.PI * 2);
    ctx.fill();
    for (const ex of [-3, 2.5]) {
      ctx.beginPath();
      ctx.moveTo(hx + ex - 2, hy - 3.5);
      ctx.lineTo(hx + ex + 0.5, hy - 9.5);
      ctx.lineTo(hx + ex + 2.8, hy - 3);
      ctx.closePath();
      ctx.fill();
    }
    // eye looking at the dot (mirror the x look when facing left)
    ctx.fillStyle = '#ffd36a';
    ctx.beginPath();
    ctx.arc(hx + 2, hy - 1, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1612';
    ctx.beginPath();
    ctx.arc(hx + 2 + this.lookX * this.facing * 0.7, hy - 1 + this.lookY * 0.7, 0.9, 0, Math.PI * 2);
    ctx.fill();
    // nose
    ctx.fillStyle = '#e07a6a';
    ctx.fillRect(hx + 5, hy + 1, 1.4, 1.2);
    // paw up in the air to grab
    if (airborne) {
      ctx.strokeStyle = BODY;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(hx - 2, hy + 4);
      ctx.lineTo(hx + 6, hy + 1);
      ctx.stroke();
    }
    ctx.restore();

    // sparkle after a catch
    if (this.sparkle > 0) {
      const a = this.sparkle / 0.6;
      ctx.save();
      ctx.translate(this.x + this.facing * 14, floor - this.y - 24);
      ctx.strokeStyle = `rgba(255,214,106,${a.toFixed(3)})`;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + this.time * 3;
        const r0 = 4 + (1 - a) * 6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
        ctx.lineTo(Math.cos(ang) * (r0 + 4), Math.sin(ang) * (r0 + 4));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawSleeping(ctx: CanvasRenderingContext2D): void {
    const breathe = 1 + Math.sin(this.time * 1.8) * 0.05;
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(0, -6, 12, 6 * breathe, 0, Math.PI, 0);
    ctx.ellipse(0, -1, 12, 1, 0, 0, Math.PI);
    ctx.fill();
    // head tucked in, ears up
    ctx.beginPath();
    ctx.arc(8, -5, 5, 0, Math.PI * 2);
    ctx.fill();
    for (const ex of [5, 10]) {
      ctx.beginPath();
      ctx.moveTo(ex - 2, -8);
      ctx.lineTo(ex, -13);
      ctx.lineTo(ex + 2, -8);
      ctx.closePath();
      ctx.fill();
    }
    // closed eye
    ctx.strokeStyle = '#1a1612';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(10, -5, 1.4, 0.2, Math.PI - 0.2);
    ctx.stroke();
    // tail wrapped around
    ctx.strokeStyle = BODY;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-11, -2);
    ctx.quadraticCurveTo(-4, 3, 6, 0);
    ctx.stroke();
    // zzz
    const z = (this.time * 0.6) % 1;
    ctx.fillStyle = `rgba(232,223,200,${(0.7 * (1 - z)).toFixed(3)})`;
    ctx.font = '8px "Space Mono", monospace';
    ctx.fillText('z', 13 + z * 6, -14 - z * 12);
  }
}
