/**
 * Sign-in for login-gated targets.
 *
 * Deterministic on purpose. There is no Operator prompt in Forge and there is no
 * prompt here either: `prompts.ts` states that a prompt is not a security
 * boundary, and a credential is the one thing a page must never be able to talk
 * its way into. So the model never sees the password and never chooses where it
 * goes - fields are selected structurally, by input type, in code.
 *
 * The password is also never written into a step, a trace line, or an event.
 * `redactSecrets` exists as a backstop for values a page echoes back on its own;
 * this module simply never emits one in the first place.
 *
 * No Cloudflare imports, so the field-selection rules are unit testable.
 */
import type {
  BrowserExecutor,
  PageElement,
  PageObservation,
} from '@/server/execution/types'
import { Budget } from '@/server/domain/budget'
import { isAuthJourney } from '@/server/domain/analysis'
import {
  CHALLENGE_VENDOR_LABEL,
  detectBotChallenge,
} from '@/server/domain/challenge'

export type Credentials = {
  loginPath: string
  username: string
  password: string
}

export type SignInResult = {
  ok: boolean
  /** Safe to log: never contains the password. */
  detail: string
  /**
   * Where the application put the browser after a successful sign-in.
   *
   * Returned so the engine can explore from there. Most applications answer a
   * sign-in by redirecting into the part of themselves that only exists once
   * you are in, and that page - not the marketing page at the base URL - is
   * what a signed-in user actually meets.
   */
  landing: PageObservation | null
}

export type LoginFields = {
  username: PageElement | null
  password: PageElement | null
  submit: PageElement | null
}

const USERNAME_HINT = /e-?mail|user|login|account|phone/i
const SUBMIT_HINT = /sign\s*in|log\s*in|login|continue|submit|next/i

/** Path only, so a query string or origin never breaks a comparison. */
export function pathOf(input: string): string {
  try {
    const path = new URL(input, 'https://placeholder.invalid').pathname
    return path.length > 1 ? path.replace(/\/+$/, '') : path
  } catch {
    return input
  }
}

/**
 * Picks the fields to drive on a login form.
 *
 * The password is found by input type alone - never by label text, which the
 * page controls. The username falls back through email type, then a name hint,
 * then simply the first text field that is not the password, which is what an
 * unlabelled two-field form looks like.
 */
export function selectLoginFields(elements: PageElement[]): LoginFields {
  const inputs = elements.filter(
    (element) => element.role === 'input' || element.role === 'textarea',
  )

  const password =
    inputs.find((element) => element.inputType === 'password') ?? null

  const candidates = inputs.filter(
    (element) => element !== password && element.inputType !== 'hidden',
  )

  const username =
    candidates.find((element) => element.inputType === 'email') ??
    candidates.find((element) => USERNAME_HINT.test(element.name)) ??
    candidates.find(
      (element) => !element.inputType || element.inputType === 'text',
    ) ??
    null

  const buttons = elements.filter((element) => element.role === 'button')
  const submit =
    buttons.find((element) => SUBMIT_HINT.test(element.name)) ??
    buttons[0] ??
    null

  return { username, password, submit }
}

/** A page showing a password field is a login form. */
export function looksLikeLoginPage(observation: PageObservation): boolean {
  return observation.elements.some(
    (element) => element.inputType === 'password',
  )
}

/**
 * Whether a sign-in worked, judged from where it ended up.
 *
 * Two signals, and the order matters. Displacement comes first: an application
 * that answers a sign-in by sending the browser somewhere else has accepted the
 * credentials, whatever the new page contains. Only when the browser is still
 * standing on the login path does the presence of a password field mean
 * rejection.
 *
 * Testing the password field alone, which is what this used to do, calls a
 * successful sign-in a failure on any application that keeps serving its login
 * form to signed-in visitors instead of redirecting them away.
 */
export function signInSucceeded(
  after: PageObservation,
  loginPath: string,
): boolean {
  if (after.status >= 400) return false
  if (pathOf(after.url) !== pathOf(loginPath)) return true
  return !looksLikeLoginPage(after)
}

/**
 * Whether a journey ran into a login wall.
 *
 * The discriminator is the journey's own intent, not the URL. Displacement is
 * the obvious signal and it is the wrong one: an application is free to answer
 * `/checkout` with the login form at HTTP 200 and no redirect at all, which is
 * the least visible form of the wall and the one most worth catching. What
 * separates a wall from a page a journey meant to reach is whether the journey
 * was trying to authenticate - a sign-up journey is *supposed* to find a
 * password field, and flagging that would bury real sign-up defects.
 *
 * This is what finally populates `FailureSignal.authWall`, declared and never
 * set since the field was introduced.
 */
export function detectAuthWall(
  observation: PageObservation,
  journey: { name: string; goal: string },
): boolean {
  if (!looksLikeLoginPage(observation)) return false
  return !isAuthJourney(journey.name, journey.goal)
}

/**
 * Drives the login form once, before any journey runs.
 *
 * The executor is shared across the whole run, so the session established here
 * carries into every journey and every reproduction attempt.
 */
export async function signIn(
  executor: BrowserExecutor,
  baseUrl: string,
  credentials: Credentials,
  budget: Budget,
): Promise<SignInResult> {
  const loginUrl = new URL(credentials.loginPath, baseUrl).toString()

  budget.spend('browserActions')
  const landing = await executor.navigate(loginUrl)
  if (!landing.ok) {
    return {
      ok: false,
      detail: `Could not open ${credentials.loginPath}: ${landing.detail}`,
      landing: null,
    }
  }

  /*
   * Checked before the fields, because it explains their absence.
   *
   * A challenge page has no password field, and saying so - "no password field
   * at /login, single sign-on is not supported" - sends whoever reads it to
   * look at an authentication setup that was never the problem. The login form
   * is behind the challenge, intact, and unreachable.
   */
  const challenge = detectBotChallenge(landing.observation)
  if (challenge) {
    return {
      ok: false,
      detail: `${CHALLENGE_VENDOR_LABEL[challenge.vendor]} bot protection answered ${credentials.loginPath} with a challenge ("${challenge.marker}") instead of the login form, so no credentials were submitted.`,
      landing: null,
    }
  }

  const fields = selectLoginFields(landing.observation.elements)

  if (!fields.password) {
    return {
      ok: false,
      detail: `No password field at ${credentials.loginPath}. Forge signs in with a username and password only; single-sign-on and magic links are not supported.`,
      landing: null,
    }
  }
  if (!fields.username) {
    return {
      ok: false,
      detail: `No username field at ${credentials.loginPath}.`,
      landing: null,
    }
  }

  budget.spend('browserActions')
  const typedUsername = await executor.fill(fields.username.ref, credentials.username)
  if (!typedUsername.ok) {
    return {
      ok: false,
      detail: 'The username field would not accept input.',
      landing: null,
    }
  }

  budget.spend('browserActions')
  const typedPassword = await executor.fill(fields.password.ref, credentials.password)
  if (!typedPassword.ok) {
    return {
      ok: false,
      detail: 'The password field would not accept input.',
      landing: null,
    }
  }

  // Submit through the password field when there is no button: a bare
  // two-field form is usually submitted by the form itself.
  const submitRef = fields.submit?.ref ?? fields.password.ref
  budget.spend('browserActions')
  const submitted = await executor.submit(submitRef)

  const after = submitted.ok ? submitted.observation : await executor.readPage()

  if (after.status >= 400) {
    return {
      ok: false,
      detail: `Sign-in returned HTTP ${after.status}.`,
      landing: null,
    }
  }

  if (!signInSucceeded(after, credentials.loginPath)) {
    // Still standing on the login path with a password field in front of us:
    // the credentials were rejected, or a second factor is being asked for.
    return {
      ok: false,
      detail: `Still on a login form at ${credentials.loginPath} after signing in as ${credentials.username}. The test account may be wrong, or the application may require a second factor.`,
      landing: null,
    }
  }

  return {
    ok: true,
    detail: `Signed in as ${credentials.username}. The application moved to ${pathOf(after.url)}.`,
    landing: after,
  }
}
