/**
 * Scene shells, and the two coordinate systems the film uses.
 *
 * `Stage` is frame coordinates: 1920×1080, used for the title cards, where the
 * only thing on screen is type and nothing has to match the product.
 *
 * `Console` is *product* coordinates. It renders a 1320×742.5 viewport - the
 * width a Forge page is actually designed against, give or take - and scales it
 * by 1.4545 to fill the frame. That indirection is worth the arithmetic:
 * every size inside a Console scene is the number from the real stylesheet, so
 * a 15px description stays `fontSize: 15` here rather than becoming a hand-tuned
 * 22, and the film cannot drift away from the product one component at a time.
 *
 * The practical consequence is that Console scenes are the product at 145%
 * browser zoom, which is exactly what a product film wants: real proportions,
 * readable on a phone.
 */
import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { color, font } from '../theme'
import { Ambience, GridBackdrop, TopBar } from '../components/chrome'

/** The product viewport, and the factor that maps it onto a 1080p frame. */
export const VIEW_W = 1320
export const VIEW_H = 742.5
export const VIEW_SCALE = 1920 / VIEW_W

export function Stage({
  children,
  grid = 1,
  bloom = 0,
  bloomHue,
  style,
}: {
  children: ReactNode
  grid?: number
  bloom?: number
  bloomHue?: string
  style?: CSSProperties
}) {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill
      style={{
        background: color.canvas,
        overflow: 'hidden',
        fontFamily: font.sans,
      }}
    >
      <GridBackdrop opacity={grid} frame={frame} />
      <Ambience frame={frame} bloom={bloom} hue={bloomHue} />
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 150px',
          ...style,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export function Console({
  children,
  /** Camera transform, applied outside the viewport scale so the two compose. */
  cameraStyle,
  style,
}: {
  children: ReactNode
  cameraStyle?: CSSProperties
  style?: CSSProperties
}) {
  return (
    <AbsoluteFill
      style={{ background: color.canvas, overflow: 'hidden', fontFamily: font.sans }}
    >
      <AbsoluteFill style={cameraStyle}>
        <div
          style={{
            width: VIEW_W,
            height: VIEW_H,
            transform: `scale(${VIEW_SCALE})`,
            transformOrigin: 'top left',
            display: 'flex',
            flexDirection: 'column',
            background: color.canvas,
          }}
        >
          <TopBar />
          {/*
           * The scroll clip.
           *
           * Scenes move the page by translating their content, and without this
           * the translated content rides up over the top bar - the mark ends up
           * sitting on top of a journey row. Clipping at the full viewport
           * width rather than at the 1180px column matters: scene 5 scales the
           * failing card past the column's width on purpose, and a clip on the
           * column would slice its edges off.
           */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              width: '100%',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 1180,
                margin: '0 auto',
                padding: '30px 20px 0',
                ...style,
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

/**
 * Page header, as every Forge object page opens: breadcrumb, title with its
 * status pills inline, then a description line. Sizes are the product's.
 */
export function PageHeader({
  above,
  title,
  description,
  actions,
  progress = 1,
}: {
  above?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  progress?: number
}) {
  return (
    <div style={{ opacity: progress, marginBottom: 26 }}>
      {above ? (
        <div
          style={{
            fontFamily: font.sans,
            fontSize: 12,
            color: color.subtle,
            marginBottom: 8,
          }}
        >
          {above}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: font.sans,
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: color.strong,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            lineHeight: 1.25,
          }}
        >
          {title}
        </h1>
        {actions ? (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{actions}</div>
        ) : null}
      </div>
      {description ? (
        <div
          style={{
            marginTop: 9,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            fontFamily: font.sans,
            fontSize: 13,
            color: color.subtle,
          }}
        >
          {description}
        </div>
      ) : null}
    </div>
  )
}

/** Kumo's primary button, at the one size the film shows it. */
export function Button({
  children,
  variant = 'primary',
  pressed = 0,
  style,
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary'
  pressed?: number
  style?: CSSProperties
}) {
  const primary = variant === 'primary'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 30,
        padding: '0 13px',
        borderRadius: 7,
        fontFamily: font.sans,
        fontSize: 13,
        fontWeight: 500,
        border: `1px solid ${primary ? 'transparent' : color.hairline}`,
        background: primary ? color.accent : color.base,
        color: primary ? 'oklch(20% 0.03 78)' : color.strong,
        transform: `scale(${1 - pressed * 0.04})`,
        ...style,
      }}
    >
      {children}
    </span>
  )
}
