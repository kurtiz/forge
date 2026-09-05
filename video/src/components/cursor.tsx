/**
 * The pointer.
 *
 * Used exactly twice - to press "Verify fix" and to settle on the failing
 * journey. A cursor that wanders the frame between shots is the surest way to
 * make a product film look like a screen recording, which is the thing this
 * whole approach exists to avoid.
 *
 * Movement is on a cubic path so the pointer arcs rather than sliding along a
 * ruler, and the press is the product's own 0.96 scale.
 */
import { color } from '../theme'
import { ramp, FORGE_EASE } from '../motion'

export function Cursor({
  from,
  to,
  frame,
  start,
  duration = 24,
  press,
  opacity = 1,
}: {
  from: [number, number]
  to: [number, number]
  frame: number
  start: number
  duration?: number
  /** Frame at which the click lands, if it does. */
  press?: number
  opacity?: number
}) {
  const t = ramp(frame, [start, start + duration], [0, 1], FORGE_EASE)
  const x = from[0] + (to[0] - from[0]) * t
  /* Arc: lift the midpoint of the path so travel is not a straight line. */
  const arc = Math.sin(t * Math.PI) * -34
  const y = from[1] + (to[1] - from[1]) * t + arc

  const pressed =
    press !== undefined && frame >= press && frame < press + 6 ? 0.86 : 1

  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `scale(${pressed})`,
        transformOrigin: '4px 3px',
        opacity,
        filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.7))',
        zIndex: 50,
      }}
    >
      <path
        d="M5 2.5 18.5 12.2l-5.6.7 3.1 6.6-2.6 1.2-3.1-6.6-4.3 3.6z"
        fill={color.strong}
        stroke={color.canvas}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The ring a click leaves behind. Fades in six frames; never lingers. */
export function ClickRing({
  at,
  frame,
  press,
}: {
  at: [number, number]
  frame: number
  press: number
}) {
  const t = ramp(frame, [press, press + 16], [0, 1])
  if (t <= 0 || t >= 1) return null
  return (
    <span
      style={{
        position: 'absolute',
        left: at[0] - 20 + 4,
        top: at[1] - 20 + 3,
        width: 40,
        height: 40,
        borderRadius: 999,
        border: `2px solid ${color.accent}`,
        opacity: (1 - t) * 0.8,
        transform: `scale(${0.3 + t * 1.1})`,
        zIndex: 49,
      }}
    />
  )
}
