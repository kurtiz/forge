import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { RequestHeadersHelp } from '@/components/app/request-headers-panel'

/*
 * The panel reaches for the router and the server functions, neither of which
 * exists outside the app. The help control under test uses neither.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouter: () => ({ invalidate: async () => {} }),
}))

vi.mock('@/server/api', () => ({
  addProjectHeader: async () => {},
  removeProjectHeader: async () => {},
}))

describe('RequestHeadersHelp trigger', () => {
  /*
   * Same trap as the account menu: Kumo hands the element in `render` to Base
   * UI, which clones it to inject the click handler, the ARIA state and a ref.
   * A trigger whose props are dropped on the way to the DOM looks exactly
   * right and opens nothing, so the wiring is what is asserted rather than the
   * icon.
   */
  const html = renderToString(<RequestHeadersHelp />)

  it('renders a real button with an accessible name', () => {
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="What request headers are for"')
  })

  it('carries the popover wiring the trigger needs to be operable', () => {
    // From Base UI rather than from the markup above, so their presence is the
    // proof that the injected props reached the DOM element.
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toMatch(/id="base-ui-/)
  })

  /* The explanation belongs behind the control, not in the page it sits on. */
  it('keeps the explanation closed until asked for', () => {
    expect(html).not.toContain('Learn more')
  })
})
