/**
 * Forge's design tokens, lifted from `apps/web/src/styles.css`.
 *
 * The trailer only ever shows the dark theme, so the `:root[data-mode="dark"]`
 * block is what is ported here. These values are copied, not approximated: the
 * amber is the product's amber and the pass/fail pair is the product's status
 * set, because a trailer whose red is a different red from the console's red
 * stops being a picture of the product.
 *
 * Kumo's own neutrals are not exported as CSS anywhere this package can import,
 * so the four surfaces and three text weights below are matched against the
 * shipped screenshots in `apps/web/public/shots/`.
 */

export const color = {
  /* Brand. One accent across the whole product, and the whole video. */
  accent: 'oklch(80% 0.15 78)',
  accentStrong: 'oklch(86% 0.13 84)',
  accentSoft: 'oklch(80% 0.15 78 / 0.16)',

  /* Status. Semantic only - these encode run state or severity, never mood. */
  pass: 'oklch(76% 0.16 158)',
  fail: 'oklch(70% 0.19 24)',
  warn: 'oklch(80% 0.15 80)',
  idle: 'oklch(62% 0.01 260)',
  live: 'oklch(76% 0.13 235)',

  /* Surfaces. */
  canvas: 'oklch(7% 0.002 260)',
  base: 'oklch(11% 0.003 260)',
  recessed: 'oklch(13.5% 0.004 260)',
  console: 'oklch(13% 0.004 260)',
  tint: 'oklch(100% 0 0 / 0.04)',

  /* Lines. */
  hairline: 'oklch(100% 0 0 / 0.10)',
  consoleLine: 'oklch(100% 0 0 / 0.07)',
  grid: 'oklch(100% 0 0 / 0.045)',

  /* Text. */
  strong: 'oklch(97% 0 0)',
  subtle: 'oklch(70% 0.01 260)',
  inactive: 'oklch(45% 0.01 260)',
} as const

export const font = {
  sans: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono Variable", ui-monospace, "SF Mono", Menlo, monospace',
} as const

/** Alpha-composited status colours, for glows and edges that must not blow out. */
export const alpha = (c: string, a: number) =>
  c.replace(/\)$/, ` / ${a})`).replace('oklch(', 'oklch(')

/**
 * The blueprint grid. Same 56px pitch as the product's landing hero, and used
 * under exactly the same conditions: title cards and empty space, never data.
 */
export const gridField = (opacity = 1) => ({
  backgroundImage: `linear-gradient(${color.grid} 1px, transparent 1px), linear-gradient(90deg, ${color.grid} 1px, transparent 1px)`,
  backgroundSize: '56px 56px',
  backgroundPosition: 'center',
  opacity,
})
