import { describe, expect, it } from 'vitest'
import {
  detectAuthWall,
  looksLikeLoginPage,
  pathOf,
  selectLoginFields,
} from '#/server/agent/authenticator'
import type { PageElement, PageObservation } from '#/server/execution/types'

const input = (over: Partial<PageElement>): PageElement => ({
  ref: over.ref ?? 'r1',
  role: 'input',
  name: '',
  ...over,
})

function observation(over: Partial<PageObservation> = {}): PageObservation {
  return {
    url: 'https://app.example.com/checkout',
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

describe('selectLoginFields', () => {
  it('finds the password by input type, never by label', () => {
    // The label lies on purpose: page-controlled text must not decide where a
    // credential is typed.
    const fields = selectLoginFields([
      input({ ref: 'a', name: 'Password', inputType: 'text' }),
      input({ ref: 'b', name: 'Nickname', inputType: 'password' }),
    ])
    expect(fields.password?.ref).toBe('b')
  })

  it('never selects a non-password field as the password', () => {
    const fields = selectLoginFields([
      input({ ref: 'a', name: 'Email', inputType: 'email' }),
      input({ ref: 'b', name: 'Password', inputType: 'text' }),
    ])
    expect(fields.password).toBeNull()
  })

  it('prefers an email field for the username', () => {
    const fields = selectLoginFields([
      input({ ref: 'a', name: 'Nickname', inputType: 'text' }),
      input({ ref: 'b', name: 'Whatever', inputType: 'email' }),
      input({ ref: 'c', name: 'Password', inputType: 'password' }),
    ])
    expect(fields.username?.ref).toBe('b')
  })

  it('falls back to a name hint, then to the first text field', () => {
    const hinted = selectLoginFields([
      input({ ref: 'a', name: 'Nickname', inputType: 'text' }),
      input({ ref: 'b', name: 'user_name', inputType: 'text' }),
      input({ ref: 'c', name: 'pw', inputType: 'password' }),
    ])
    expect(hinted.username?.ref).toBe('b')

    const bare = selectLoginFields([
      input({ ref: 'a', name: '', inputType: 'text' }),
      input({ ref: 'b', name: '', inputType: 'password' }),
    ])
    expect(bare.username?.ref).toBe('a')
  })

  it('ignores hidden fields such as CSRF tokens', () => {
    const fields = selectLoginFields([
      input({ ref: 'csrf', name: '_token', inputType: 'hidden' }),
      input({ ref: 'a', name: '', inputType: 'text' }),
      input({ ref: 'b', name: '', inputType: 'password' }),
    ])
    expect(fields.username?.ref).toBe('a')
  })

  it('prefers a submit button whose name reads like sign-in', () => {
    const fields = selectLoginFields([
      { ref: 'x', role: 'button', name: 'Cancel' },
      { ref: 'y', role: 'button', name: 'Log in' },
    ])
    expect(fields.submit?.ref).toBe('y')
  })

  it('returns nulls for a page with no form', () => {
    const fields = selectLoginFields([{ ref: 'l', role: 'link', name: 'Home' }])
    expect(fields).toEqual({ username: null, password: null, submit: null })
  })
})

describe('looksLikeLoginPage', () => {
  it('is true when a password field is present', () => {
    expect(
      looksLikeLoginPage(
        observation({ elements: [input({ inputType: 'password' })] }),
      ),
    ).toBe(true)
  })

  it('is false otherwise', () => {
    expect(
      looksLikeLoginPage(observation({ elements: [input({ inputType: 'text' })] })),
    ).toBe(false)
  })
})

describe('detectAuthWall', () => {
  const checkout = { name: 'Complete checkout', goal: 'Buy a plan' }
  const signup = { name: 'Create an account', goal: 'Register a new user' }
  const login = { name: 'Sign in', goal: 'Log in to the app' }
  const walled = observation({
    url: 'https://app.example.com/login',
    elements: [input({ inputType: 'password' })],
  })

  it('flags a journey redirected to a login form', () => {
    expect(detectAuthWall(walled, checkout)).toBe(true)
  })

  it('flags a login form served at the requested URL with no redirect', () => {
    // The least visible form of the wall: HTTP 200, same path, login form.
    // A displacement-based check misses this entirely.
    const inPlace = observation({
      url: 'https://app.example.com/checkout',
      elements: [input({ inputType: 'password' })],
    })
    expect(detectAuthWall(inPlace, checkout)).toBe(true)
  })

  it('does not flag a journey that is itself about authenticating', () => {
    // A password field is this journey working, not a wall - flagging it would
    // bury real sign-up and sign-in defects.
    expect(detectAuthWall(walled, signup)).toBe(false)
    expect(detectAuthWall(walled, login)).toBe(false)
  })

  it('is false on a page with no login form', () => {
    expect(detectAuthWall(observation({ url: 'https://a.test/x' }), checkout)).toBe(
      false,
    )
  })
})

describe('pathOf', () => {
  it('strips origin, query, and trailing slash', () => {
    expect(pathOf('https://a.test/checkout/?x=1')).toBe('/checkout')
    expect(pathOf('/checkout')).toBe('/checkout')
    expect(pathOf('/')).toBe('/')
  })
})
