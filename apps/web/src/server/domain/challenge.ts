/**
 * Bot-protection detection.
 *
 * A verification run against a site behind Cloudflare, DataDome or the like
 * does not fail loudly. It succeeds at everything: the interstitial answers
 * HTTP 200, it has a title, it has headings, it even has links. So the run
 * explores it, discovers journeys from it - "Verify Security", "View Privacy
 * Policy" are the two the Cloudflare screen offers - tries to drive them,
 * finds no matching control because the widget lives in a cross-origin frame,
 * and reports the whole thing as an application with nothing on it. Every
 * sentence in that report is wrong, and none of it says the only true thing:
 * Forge never saw the application.
 *
 * This module is the discriminator. It is deliberately conservative, because
 * the expensive mistake here is the other one: calling a real page a challenge
 * hides genuine defects behind an environment excuse. A page counts as a wall
 * only when it says something an interstitial says *and* offers nothing an
 * application offers - which is what keeps a login form carrying a Turnstile
 * widget classified as a login form.
 *
 * Forge does not solve or evade what it finds here. It reports it, names the
 * service, and stops. A tool that taught itself to defeat bot protection would
 * be a tool nobody could safely point at their own production site.
 */
import type { PageObservation } from '@/server/execution/types'

export type ChallengeVendor =
  | 'cloudflare'
  | 'hcaptcha'
  | 'recaptcha'
  | 'datadome'
  | 'imperva'
  | 'akamai'
  | 'aws-waf'
  | 'unknown'

export const CHALLENGE_VENDOR_LABEL: Record<ChallengeVendor, string> = {
  cloudflare: 'Cloudflare',
  hcaptcha: 'hCaptcha',
  recaptcha: 'reCAPTCHA',
  datadome: 'DataDome',
  imperva: 'Imperva',
  akamai: 'Akamai',
  'aws-waf': 'AWS WAF',
  unknown: 'A bot-protection service',
}

export type BotChallenge = {
  vendor: ChallengeVendor
  /**
   * The phrase that identified it, verbatim.
   *
   * Quoted in the finding so a reader can check the call rather than trust it:
   * "it said *Verify you are human*" is auditable, "it looked like a challenge"
   * is not.
   */
  marker: string
}

/**
 * Phrases that only appear on an interstitial.
 *
 * Every one of these is text the protection service writes itself. Nothing
 * here is a phrase an application would put on a working page - which is the
 * bar, because this list is half of the decision.
 */
const CHALLENGE_PHRASES: readonly RegExp[] = [
  /just a moment/i,
  /performing security verification/i,
  /checking (?:your browser|if the site connection is secure)/i,
  /verify(?:ing)? (?:that )?you are (?:a )?human/i,
  /verify you are human/i,
  /enable (?:javascript|js) and cookies to continue/i,
  /needs to review the security of your connection/i,
  /uses a security service to protect (?:itself )?against (?:malicious bots|online attacks)/i,
  /attention required!?\s*\|\s*cloudflare/i,
  /(?:sorry, )?you have been blocked/i,
  /incapsula incident id/i,
  /pardon our interruption/i,
  /please enable (?:js|javascript) and disable any ad ?blocker/i,
  /additional security check is required/i,
  /reference #\d+\.[0-9a-f]+/i,
  /i'?m not a robot/i,
]

/** How the service signs its work, once something else has said it is a wall. */
const VENDOR_PATTERNS: ReadonlyArray<[ChallengeVendor, RegExp]> = [
  ['cloudflare', /cloudflare|cdn-cgi\/challenge-platform|\bray id\b|turnstile/i],
  ['hcaptcha', /hcaptcha/i],
  ['recaptcha', /recaptcha|i'?m not a robot/i],
  // Its interstitial names itself nowhere; the sentence is the signature.
  [
    'datadome',
    /datadome|please enable (?:js|javascript) and disable any ad ?blocker/i,
  ],
  ['imperva', /imperva|incapsula/i],
  ['akamai', /akamai|reference #\d+\.[0-9a-f]+/i],
  ['aws-waf', /aws ?waf|awswaf/i],
]

/**
 * How many links a page may offer and still be a bare challenge screen.
 *
 * Cloudflare's is not empty: it links its own site, a privacy notice, and
 * sometimes a help page. Three, plus room for one more, is the whole budget -
 * a navigation bar puts a page well past it.
 */
const MAX_CHALLENGE_LINKS = 4

/** Names the service behind a challenge from any text that mentions it. */
export function vendorFromText(text: string): ChallengeVendor | null {
  for (const [vendor, pattern] of VENDOR_PATTERNS) {
    if (pattern.test(text)) return vendor
  }
  return null
}

/**
 * Whether the page offers anything an application would offer.
 *
 * The second half of the decision, and the half that protects real pages. A
 * form, a button, a select - any control at all - means someone built this
 * page to be used, and a challenge screen is not built to be used by anything
 * except its own widget, which sits in a frame this observation cannot see
 * into. Hidden inputs do not count: a challenge carries several of its own.
 */
function offersApplicationSurface(observation: PageObservation): boolean {
  let links = 0
  for (const element of observation.elements) {
    if (element.role === 'link') {
      links += 1
      continue
    }
    if (element.inputType === 'hidden') continue
    return true
  }
  return links > MAX_CHALLENGE_LINKS
}

/**
 * Identifies a page that is a bot challenge rather than the application.
 *
 * Two ways in. The first is a phrase the service wrote, on a page with nothing
 * to use. The second covers the challenge that says almost nothing at all -
 * a bare 403 or 503 from the edge - where the vendor's own name in the body is
 * the only text there is.
 */
export function detectBotChallenge(
  observation: PageObservation,
): BotChallenge | null {
  const haystack = [
    observation.title,
    ...observation.headings,
    observation.text,
  ].join(' ')

  if (offersApplicationSurface(observation)) return null

  for (const pattern of CHALLENGE_PHRASES) {
    const match = pattern.exec(haystack)
    if (!match) continue
    return {
      vendor: vendorFromText(haystack) ?? 'unknown',
      marker: match[0].trim(),
    }
  }

  /*
   * The wordless case. An edge that answers 403 or 503 with its own name and
   * no explanation is still an edge answering for the application, and the
   * status is what makes it safe to say so without a phrase to quote.
   */
  if (observation.status === 403 || observation.status === 503) {
    const network = observation.networkErrors.join(' ')
    const vendor = vendorFromText(`${haystack} ${network}`)
    if (vendor) {
      return { vendor, marker: `HTTP ${observation.status}` }
    }
  }

  return null
}
