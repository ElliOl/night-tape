import { memo, useCallback, useId, useRef, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';

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
}

const SWEEP = 270; // degrees from min to max
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Rotary knob (vertical drag, wheel, arrow keys; double-click resets). Accessible as an ARIA slider.
 */
function KnobImpl({ label, value, onChange, display, defaultValue, size = 'sm', disabled, title }: KnobProps) {
  const id = useId();
  const drag = useRef<{ y: number; v: number } | null>(null);
  const shown = display ?? `${Math.round(value * 100)}%`;
  const angle = -SWEEP / 2 + value * SWEEP;

  const set = useCallback((v: number) => onChange(Math.round(clamp01(v) * 1000) / 1000), [onChange]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { y: e.clientY, v: value };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const fine = e.shiftKey ? 0.25 : 1;
    set(drag.current.v + ((drag.current.y - e.clientY) / 180) * fine);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
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
    <div className={`knob knob--${size}${disabled ? ' is-disabled' : ''}`} title={title}>
      <div
        className="knob__dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={id}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={shown}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onDoubleClick={() => defaultValue !== undefined && !disabled && set(defaultValue)}
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
