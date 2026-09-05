/**
 * The target application's error page.
 *
 * Rendered the way the fixture renders it - light, system font, the error in a
 * code element - because the one thing on screen that is supposed to be
 * somebody else's application should not be wearing Forge's design system.
 * Copy is verbatim from `apps/web/src/server/demo/app.ts`.
 *
 * `dim` darkens the whole page rather than fading it out. A white page fading
 * to a dark canvas passes through grey and reads as a lighting change; a white
 * page going dark under a scrim reads as attention moving off it, which is what
 * scene 7 is doing when it hands over to the sandbox.
 */
import { font } from '../theme'
import { ERROR_TEXT, ERROR_FRAME } from '../data/demoRun'

export function NorthbeamError({ dim = 0 }: { dim?: number }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#f7f7f8' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          color: '#18181b',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            padding: '18px 32px',
            background: '#fff',
            borderBottom: '1px solid #e4e4e7',
            fontSize: 19,
          }}
        >
          <strong style={{ letterSpacing: '-0.01em' }}>Northbeam</strong>
          <span style={{ display: 'flex', gap: 22, color: '#52525b', fontSize: 17 }}>
            <span>Dashboard</span>
            <span>Checkout</span>
            <span>Invite teammate</span>
            <span>Pricing</span>
          </span>
        </div>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '58px 24px' }}>
          <h1 style={{ fontSize: 40, letterSpacing: '-0.02em', margin: '0 0 18px' }}>
            Something went wrong
          </h1>
          <p style={{ margin: 0 }}>
            <code
              style={{
                fontFamily: font.mono,
                fontSize: 19,
                lineHeight: 1.7,
                color: '#b91c1c',
              }}
            >
              {ERROR_TEXT}
              <br />
              {'    '}
              {ERROR_FRAME}
            </code>
          </p>
        </div>
      </div>

      {/* The scrim. Darkens rather than fades - see the note above. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: '#000',
          opacity: dim,
        }}
      />
    </div>
  )
}
