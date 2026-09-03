import { describe, expect, it } from 'vitest'
import {
  detectBotChallenge,
  vendorFromText,
} from '@/server/domain/challenge'
import type { PageElement, PageObservation } from '@/server/execution/types'

function observation(over: Partial<PageObservation> = {}): PageObservation {
  return {
    url: 'https://app.example.com/',
    title: '',
    status: 200,
    headings: [],
    elements: [],
    text: '',
    consoleErrors: [],
    networkErrors: [],
    ...over,
  }
}

const element = (over: Partial<PageElement>): PageElement => ({
  ref: over.ref ?? 'e1',
  role: over.role ?? 'button',
  name: over.name ?? '',
  ...over,
})

/**
 * The page that started this: a Cloudflare managed challenge, answering 200,
 * with the Turnstile widget inside a cross-origin frame the page model cannot
 * see into. Everything here is what the observation actually carried.
 */
const cloudflareInterstitial = observation({
  title: 'app.example.com',
  headings: ['app.example.com', 'Performing security verification'],
  text:
    'app.example.com Performing security verification This website uses a security service ' +
    'to protect against malicious bots. This page is displayed while the website verifies you ' +
    'are not a bot. Ray ID: a3542a06b97b2c2d Performance and Security by Cloudflare Privacy',
  elements: [
    element({ ref: 'e1', role: 'link', name: 'Cloudflare', href: 'https://www.cloudflare.com' }),
    element({ ref: 'e2', role: 'link', name: 'Privacy', href: 'https://www.cloudflare.com/privacypolicy/' }),
  ],
})

describe('detectBotChallenge', () => {
  it('recognises a Cloudflare interstitial that answered 200', () => {
    const found = detectBotChallenge(cloudflareInterstitial)
    expect(found?.vendor).toBe('cloudflare')
    expect(found?.marker).toMatch(/security verification/i)
  })

  it('leaves a real page alone', () => {
    expect(
      detectBotChallenge(
        observation({
          title: 'Dashboard',
          headings: ['Your projects'],
          text: 'Three projects. Last run 4 minutes ago.',
          elements: [element({ name: 'New project' })],
        }),
      ),
    ).toBeNull()
  })

  it('leaves a login form carrying a widget alone', () => {
    // The discriminator that matters most. A page with the phrase on it *and*
    // a form to fill is a page Forge can and should drive; calling it a wall
    // would hide every defect behind it behind an environment excuse.
    expect(
      detectBotChallenge(
        observation({
          url: 'https://app.example.com/login',
          title: 'Sign in',
          text: 'Sign in to your account. Verify you are human.',
          elements: [
            element({ ref: 'a', role: 'input', name: 'Email', inputType: 'email' }),
            element({ ref: 'b', role: 'input', name: 'Password', inputType: 'password' }),
            element({ ref: 'c', role: 'button', name: 'Sign in' }),
          ],
        }),
      ),
    ).toBeNull()
  })

  it('leaves a page alone when the phrase sits in real navigation', () => {
    expect(
      detectBotChallenge(
        observation({
          text: 'Just a moment while we load your dashboard.',
          elements: [
            element({ ref: 'l1', role: 'link', name: 'Home', href: '/' }),
            element({ ref: 'l2', role: 'link', name: 'Projects', href: '/projects' }),
            element({ ref: 'l3', role: 'link', name: 'Runs', href: '/runs' }),
            element({ ref: 'l4', role: 'link', name: 'Settings', href: '/settings' }),
            element({ ref: 'l5', role: 'link', name: 'Docs', href: '/docs' }),
          ],
        }),
      ),
    ).toBeNull()
  })

  it('ignores the hidden inputs a challenge carries of its own', () => {
    const found = detectBotChallenge(
      observation({
        ...cloudflareInterstitial,
        elements: [
          ...cloudflareInterstitial.elements,
          element({ ref: 'h1', role: 'input', name: '', inputType: 'hidden' }),
        ],
      }),
    )
    expect(found).not.toBeNull()
  })

  it('reads a wordless 403 from the edge when the vendor signs it', () => {
    const found = detectBotChallenge(
      observation({
        status: 403,
        text: 'Error',
        networkErrors: ['403 /cdn-cgi/challenge-platform/h/b/jsd/r/x'],
      }),
    )
    expect(found?.vendor).toBe('cloudflare')
    expect(found?.marker).toBe('HTTP 403')
  })

  it('will not call an unexplained 403 a challenge', () => {
    // A permission problem is a finding of its own, and a much more useful one
    // than a guess about an edge that left no trace of itself.
    expect(detectBotChallenge(observation({ status: 403, text: 'Forbidden' }))).toBeNull()
  })

  it('names the other services it meets', () => {
    expect(
      detectBotChallenge(observation({ text: 'Please enable JS and disable any ad blocker' }))
        ?.vendor,
    ).toBe('datadome')
    expect(
      detectBotChallenge(observation({ text: 'Incapsula incident ID: 1234-5678' }))?.vendor,
    ).toBe('imperva')
    expect(
      detectBotChallenge(
        observation({ text: 'Access Denied. Reference #18.2f3a1c02.1712345678' }),
      )?.vendor,
    ).toBe('akamai')
  })
})

describe('vendorFromText', () => {
  it('finds the service named in a finding description', () => {
    expect(vendorFromText('Cloudflare answered app.example.com')).toBe('cloudflare')
    expect(vendorFromText('hCaptcha answered app.example.com')).toBe('hcaptcha')
  })

  it('names nobody when nobody is named', () => {
    expect(vendorFromText('The page did not load')).toBeNull()
  })
})
