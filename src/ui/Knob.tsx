import { memo, useCallback, useId, useRef, type DragEvent, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';

interface KnobProps {
  label: string;
  /** 0..1 */
  value: number;
  onChange(v: number): void;
  /** text under the knob; default percent */
  display?: string;
  /** double-click resets to this */
  defaultValue?: number;
  size?: 'sm' | 'lg';
  disabled?: boolean;
  title?: string;
  /** where the chaos LFO is currently pushing this knob (0..1); drawn as a moving dot */
  mod?: number;
}

const SWEEP = 270; // degrees from min to max
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Rotary knob (vertical drag, wheel, arrow keys; double-click resets). Accessible as an ARIA slider.
 */
function KnobImpl({ label, value, onChange, display, defaultValue, size = 'sm', disabled, title, mod }: KnobProps) {
  const id = useId();
  const drag = useRef<{ y: number; v: number; id: number } | null>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const shown = display ?? `${Math.round(value * 100)}%`;
  const angle = -SWEEP / 2 + value * SWEEP;

  const set = useCallback((v: number) => onChange(Math.round(clamp01(v) * 1000) / 1000), [onChange]);

  // The whole knob (dial, label, value) is the drag handle. preventDefault on pointerdown stops the browser from
  // selecting text or starting a native drag-and-drop (the "not allowed" cursor), which used to cancel the gesture.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // capture is best effort (e.g. synthetic events)
    }
    dialRef.current?.focus({ preventScroll: true });
    drag.current = { y: e.clientY, v: value, id: e.pointerId };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // released outside the window without a pointerup: stop following
    if (e.buttons === 0 && e.pointerType === 'mouse') {
      drag.current = null;
      return;
    }
    const fine = e.shiftKey ? 0.25 : 1;
    set(d.v + ((d.y - e.clientY) / 180) * fine);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const noNativeDrag = (e: DragEvent<HTMLDivElement>) => e.preventDefault();
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (disabled || document.activeElement !== e.currentTarget) return;
    set(value - Math.sign(e.deltaY) * 0.02);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = e.shiftKey ? 0.1 : 0.02;
    let v: number | null = null;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = value + step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = value - step;
    else if (e.key === 'PageUp') v = value + 0.1;
    else if (e.key === 'PageDown') v = value - 0.1;
    else if (e.key === 'Home') v = 0;
    else if (e.key === 'End') v = 1;
    if (v !== null) {
      e.preventDefault();
      set(v);
    }
  };

  return (
    <div
      className={`knob knob--${size}${disabled ? ' is-disabled' : ''}`}
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onDragStart={noNativeDrag}
      onDoubleClick={() => defaultValue !== undefined && !disabled && set(defaultValue)}
    >
      <div
        ref={dialRef}
        className="knob__dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={shown}
        aria-disabled={disabled || undefined}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle className="knob__track" cx="32" cy="32" r="27" pathLength={360} strokeDasharray={`${SWEEP} 360`} transform="rotate(135 32 32)" />
          <circle
            className="knob__fill"
            cx="32"
            cy="32"
            r="27"
            pathLength={360}
            strokeDasharray={`${value * SWEEP} 360`}
            transform="rotate(135 32 32)"
          />
          {mod !== undefined && Math.abs(mod - value) > 0.004 && (
            <circle
              className="knob__mod"
              r={3.2}
              cx={32 + 27 * Math.cos(((135 + mod * SWEEP) * Math.PI) / 180)}
              cy={32 + 27 * Math.sin(((135 + mod * SWEEP) * Math.PI) / 180)}
            />
          )}
        </svg>
        <div className="knob__cap" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="knob__mark" />
        </div>
      </div>
      <div className="knob__label" id={id}>
        {label}
      </div>
      <div className="knob__value">{shown}</div>
    </div>
  );
}

export const Knob = memo(KnobImpl);
