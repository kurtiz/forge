/**
 * Typography for the title cards.
 *
 * Three sizes and nothing else. The film's text is either a statement (large,
 * tight, balanced) a kicker (small, spaced, uppercase, subtle) or a caption.
 * Anything that needed a fourth size was a shot that needed rewriting.
 */
import type { CSSProperties, ReactNode } from 'react'
import { color, font } from '../theme'
import { wipeUp } from '../motion'

export function Statement({
  children,
  progress,
  size = 76,
  tone = color.strong,
  style,
}: {
  children: ReactNode
  /** 0..1, drives a hard-edged wipe from below rather than a fade. */
  progress: number
  size?: number
  tone?: string
  style?: CSSProperties
}) {
  return (
    <div style={{ overflow: 'hidden', ...style }}>
      <div
        style={{
          ...wipeUp(progress),
          transform: `translateY(${(1 - progress) * 0.18 * size}px)`,
        }}
      >
        <span
          style={{
            display: 'block',
            fontFamily: font.sans,
            fontSize: size,
            fontWeight: 600,
            letterSpacing: '-0.035em',
            lineHeight: 1.06,
            color: tone,
            textWrap: 'balance',
          }}
        >
          {children}
        </span>
      </div>
    </div>
  )
}

export function Kicker({
  children,
  progress = 1,
  tone = color.subtle,
  style,
}: {
  children: ReactNode
  progress?: number
  tone?: string
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 15,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: tone,
        opacity: progress,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Caption({
  children,
  progress = 1,
  style,
}: {
  children: ReactNode
  progress?: number
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        fontFamily: font.sans,
        fontSize: 22,
        lineHeight: 1.45,
        color: color.subtle,
        opacity: progress,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
