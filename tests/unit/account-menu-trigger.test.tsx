import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { AccountMenu } from '#/components/app/account-menu'

/*
 * The menu needs a router and an auth client, neither of which exists outside
 * the app. Only the trigger markup is under test here, so both are stubbed.
 */
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: async () => {}, navigate: async () => {} }),
}))

vi.mock('#/lib/auth-client', () => ({
  authClient: { signOut: async () => {} },
}))

const user = {
  id: 'usr_1',
  name: 'Ines Caetano',
  email: 'ines@example.com',
  isAnonymous: false,
}

describe('AccountMenu trigger', () => {
  /*
   * The bug this guards against: Kumo turns the trigger's child into Base UI's
   * `render` prop, which clones it and injects the click handler, the ARIA
   * state and a ref. A child that does not spread props onto a DOM node - the
   * Avatar component, say - renders an avatar that looks right and does
   * nothing at all.
   */
  const html = renderToString(<AccountMenu user={user} />)

  it('renders a real button', () => {
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="Account"')
  })

  it('carries the menu wiring the trigger needs to be operable', () => {
    /*
     * These come from Base UI, not from the markup above, so finding them on
     * the button is the proof that the injected props reached the DOM element
     * rather than being dropped by a component that ignores them.
     * `aria-expanded` is not among them: a closed menu does not render it.
     */
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('tabindex="0"')
    expect(html).toMatch(/id="base-ui-/)
  })

  it('shows the account initials inside the trigger', () => {
    expect(html).toContain('IC')
  })
})
