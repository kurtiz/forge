/**
 * What to do about a finding.
 *
 * A report that ends at "here is what broke" leaves the reader to work out who
 * owns it, which is where most of them stall: a bot challenge and a 500 both
 * arrive as a red row, and only one of them is the application's fault. So each
 * finding carries three things - a headline, the steps a person takes, and a
 * brief written for a coding agent, because that is how the fix is actually
 * going to be attempted.
 *
 * The agent brief is deliberately not a fix. It carries the evidence the run
 * holds and nothing else: the journey, the steps as they happened, the verdict,
 * the reproduction count, the files the source investigation touched. It ends
 * with rules, and the rules matter more than the instructions - an agent told
 * only "make this pass" will change the test, weaken the assertion, or special
 * case the exact path the run walked, and all three produce a green check over
 * a bug that is still there.
 *
 * Pure and deterministic, like the rest of `domain`: no model writes this, so
 * it says the same thing every time and can be tested.
 */
import type { FailureClass, Severity } from '@/server/contracts'
import {
  CHALLENGE_VENDOR_LABEL,
  vendorFromText,
  type ChallengeVendor,
} from './challenge'

export type RemediationStep = {
  action: string
  target: string | null
  expected: string | null
  actual: string | null
  status: 'passed' | 'failed' | 'skipped'
}

export type RemediationInput = {
  finding: {
    title: string
    description: string
    failureClass: FailureClass
    severity: Severity
    rootCause: string | null
    affectedFiles: readonly string[]
    reproductionAttempts: number
    reproductionFailures: number
  }
  run: { targetUrl: string; executor: 'solari' | 'fetch' }
  journey: { name: string; goal: string; entryPath: string } | null
  steps: readonly RemediationStep[]
  /**
   * Names of the verification headers the project already sends, if any.
   *
   * What changes the advice for a bot challenge, and changes it completely: a
   * project that sends a header has a secret an edge rule can match, and the
   * fix is one rule. A project that sends none has to create that secret first,
   * and telling it to write the rule anyway produces a rule matching nothing.
   */
  verificationHeaders?: readonly string[]
}

/**
 * Who has to act.
 *
 * `forge` is the case people miss: the finding is real, and the change belongs
 * in this project's own settings rather than in anybody's application code.
 */
export type RemediationOwner = 'application' | 'infrastructure' | 'forge' | 'none'

export type Remediation = {
  /** One sentence, imperative. The thing to do, before any explanation. */
  headline: string
  owner: RemediationOwner
  /** What a person does, in order. */
  steps: string[]
  /** Paste-ready brief for a coding agent. Null when there is nothing to fix. */
  prompt: string | null
}

export function remediationFor(input: RemediationInput): Remediation {
  switch (input.finding.failureClass) {
    case 'BOT_CHALLENGE':
      return botChallenge(input)
    case 'AUTH_FAILURE':
      return authFailure(input)
    case 'NETWORK_FAILURE':
    case 'TIMEOUT':
      return unreachable(input)
    case 'ENVIRONMENT_FAILURE':
      return environment(input)
    case 'BROWSER_FAILURE':
    case 'SOLARI_FAILURE':
    case 'AGENT_ERROR':
      return agentError()
    default:
      return applicationBug(input)
  }
}

/* ------------------------------------------------------------ per class */

function applicationBug(input: RemediationInput): Remediation {
  const { finding } = input
  const unconfirmed =
    finding.reproductionAttempts > 0 &&
    finding.reproductionFailures < finding.reproductionAttempts

  return {
    headline: unconfirmed
      ? 'Reproduce it before changing anything: this failed some attempts and not others.'
      : 'Fix the failure the run reproduced, then add a test that would have caught it.',
    owner: 'application',
    steps: [
      'Walk the steps below by hand against the same environment, and confirm you see what the run saw.',
      finding.rootCause
        ? 'Treat the proposed root cause as a lead. Confirm it in the code, or discard it.'
        : 'Find the cause from the evidence: the failing step, the console errors, the network errors.',
      'Fix the cause rather than the path the run took, so the next journey through the same code is fixed too.',
      'Add a regression test at the layer the bug lives in, and check that it fails without your change.',
      'Re-run the verification from the finding page to confirm the failure is gone.',
    ],
    prompt: [
      brief(input),
      section('What I want you to do', [
        '1. Reproduce the failure locally by the steps above, against the same code the run tested. If it will not reproduce, stop and say so rather than changing code on a guess.',
        '2. Find the cause. The root cause noted above, if any, is a lead drawn from runtime evidence; confirm it in the code or discard it.',
        '3. Fix the cause, not the symptom. Do not special-case the exact input, route or selector the run used.',
        '4. Add a regression test that fails without your fix and passes with it. Put it at the layer the bug lives in.',
        '5. Report back with: what was actually broken, what you changed, and which test now covers it.',
      ]),
      RULES,
    ].join('\n\n'),
  }
}

/**
 * The finding this whole module was written for.
 *
 * Nothing here tries to get past the challenge, and the brief says so twice,
 * because an agent handed "the scanner is blocked, unblock it" will otherwise
 * reach for a solver, a stealth flag, or a rotating user agent. The fix is an
 * origin the owner has deliberately opened, and it is a configuration change.
 */
function botChallenge(input: RemediationInput): Remediation {
  const vendorKey = vendorFromText(input.finding.description) ?? 'unknown'
  const vendor = CHALLENGE_VENDOR_LABEL[vendorKey]
  const host = hostOf(input.run.targetUrl)
  const headers = input.verificationHeaders ?? []
  const configured = headers.length > 0
  const headerList = headers.join(', ')

  /*
   * Two different fixes, and which one applies is a fact about the project
   * rather than a preference. The header is the better mechanism - it is a
   * secret, so the rule it keys cannot be guessed by anyone scanning the site -
   * but it only exists once somebody has set one.
   */
  const mechanism = configured
    ? `Forge already sends ${headerList} on every request it makes to ${host}, so there is a secret to match.`
    : `Forge sends no verification header for this project yet. Add one first (project page, "Request headers"), because a rule keyed on a header is the only allowlist here that a stranger cannot also satisfy.`

  const consolePath = CONSOLE_PATH[vendorKey]
  const inCode = isApplicationLevel(vendorKey)

  return {
    headline: configured
      ? `Let Forge through with a rule that matches ${headerList}, or point it at an origin ${vendor} does not challenge.`
      : `Give Forge a verification header, then let that header through ${vendor} - or point it at an origin that does not challenge it.`,
    owner: inCode ? 'application' : 'infrastructure',
    steps: [
      `Confirm the challenge yourself: request ${host} with no browser session and look at what comes back.`,
      'Consider a different target first. A preview or staging hostname without bot protection needs no rule at all, and keeps production untouched.',
      configured
        ? `Otherwise let ${headerList} through, with the value this project stores. ${consolePath}`
        : `Otherwise add one under "Request headers" on this project - any name, a long random value - and then let that header through. ${consolePath}`,
      inCode
        ? 'Keep it narrow: preview hostnames only, and never a path that reaches production. Rotate the value like any other secret.'
        : 'Keep the rule narrow: this hostname, the paths under verification, skip the challenge and nothing else. Rotate the value like any other secret.',
      'Re-run the verification. A run that got through discovers journeys from your own pages instead of from the challenge screen.',
    ],
    prompt: [
      `# Let our verification agent through ${vendor} on ${host}`,
      '',
      `Our verification agent cannot reach ${host}. Every request is answered by ${vendor}'s bot-protection challenge instead of the application, so no page was ever loaded and nothing was tested. The agent drives a real browser but does not solve or evade challenges, by design.`,
      '',
      mechanism,
      '',
      `Observed: ${oneLine(input.finding.description)}`,
      '',
      section('What I want you to do', [
        `1. Work out where this protection is configured for ${host}. Look in the repository first - infrastructure-as-code, edge config, a WAF or firewall rule set, framework middleware - and name the file if you find one.`,
        `2. If it is not in the repository, do not stop there: it is almost certainly a dashboard setting. Say so, and give me the exact path to it and the fields to fill. For reference, this is where it usually lives for this service: ${consolePath}`,
        '3. Check whether we already have an environment without this protection (a preview or staging deployment). If we do, say so: pointing the verification at that hostname is simpler than any rule, and I want to weigh it first.',
        configured
          ? `4. Otherwise define one rule that lets requests to ${host} carrying the header ${headerList} through the challenge. Match on the header name AND its exact value - the value is a secret we hold, not a marker anyone can copy. Prefer a change we keep in version control; where the service only offers a dashboard, give me the click path and the exact expression to paste.`
          : `4. Otherwise define one rule that lets requests to ${host} carrying a named header with a secret value through the challenge. Tell me the header name to use and where its value should be stored; I will set the same pair on the verification project. Prefer a change we keep in version control; where the service only offers a dashboard, give me the click path and the exact expression to paste.`,
        '5. Make sure it is evaluated before whatever issues the challenge, and scope it as tightly as it can be: this hostname, the paths under verification, that challenge only. It must not disable other protections, and it must not apply to any other hostname.',
        '6. State the trade-off in plain words: what that rule stops protecting, and what happens if the secret leaks. Tell me how to rotate it.',
        '7. Give me a command I can run to verify the fix - a request with the header that returns our own HTML, and one without it that still gets the challenge.',
      ]),
      '',
      section('Rules', [
        '- Do not attempt to solve, bypass, or automate past the challenge. No CAPTCHA solvers, no stealth or fingerprint-spoofing browser flags, no rotating user agents. If that is the only path you can find, stop and tell me.',
        '- Do not key the rule on anything a stranger can also send. A user agent, an IP range we do not control, or a path is not a secret.',
        '- Do not disable bot protection globally, and do not weaken it on a hostname that serves real users or real data.',
        inCode
          ? '- This challenge is rendered by our own code, so a code change is expected here - but only to gate the widget by environment. Do not remove it, and do not weaken it in production.'
          : '- Change configuration only. This finding is not evidence of any defect in the application code.',
      ]),
    ].join('\n'),
  }
}

/**
 * Where the rule actually gets written, per service.
 *
 * The first version of this told an agent to find the configuration in the
 * repository and to say so if it was not there. That is a dead end: most edge
 * protection is a dashboard setting and has never been in anybody's
 * repository, so the honest answer - "it is not in version control" - left the
 * reader exactly where they started. These are the click paths, so that answer
 * becomes a place to go rather than a shrug.
 *
 * Kept short and structural. A menu label may be renamed by the vendor next
 * quarter; the shape of the thing to look for - a rule that runs before the
 * challenge, matching a header, whose action is skip or allow - will not be.
 */
const CONSOLE_PATH: Record<ChallengeVendor, string> = {
  cloudflare:
    'Cloudflare dashboard → your zone → Security → WAF → Custom rules: a rule whose action is Skip, ticking the components that issue the challenge (Super Bot Fight Mode, managed rules), ordered above whatever is challenging. Plain Bot Fight Mode cannot be exempted by a custom rule, so check which product is challenging before writing one.',
  'aws-waf':
    'AWS console → WAF & Shield → Web ACLs → your ACL → Rules: a custom rule matching the header, action Allow, at a lower priority number than the bot-control or challenge rule so it is evaluated first.',
  akamai:
    'Akamai Control Center → Security → your security configuration → Bot Manager: an exception, or a bypass match target, for requests carrying the header.',
  imperva:
    'Imperva Cloud WAF console → your site → Security → Bot Access Control: an allow rule for requests carrying the header, above the challenge policy.',
  datadome:
    'DataDome dashboard → Management → Custom rules: an allow rule matching the header, so those requests are never scored.',
  recaptcha:
    'This one is in your own application rather than at an edge - your code renders the widget. Gate it on the header in preview environments only, never in production.',
  hcaptcha:
    'This one is in your own application rather than at an edge - your code renders the widget. Gate it on the header in preview environments only, never in production.',
  unknown:
    "Wherever the protection in front of this hostname lives: your CDN or host's firewall, bot-management, or deployment-protection settings. Some hosts publish a bypass secret for exactly this case - Vercel's protection bypass for automation, for one - and if yours does, use its documented header name and value here instead of inventing one.",
}

/** Whether the challenge is the application's own code rather than an edge. */
function isApplicationLevel(vendor: ChallengeVendor): boolean {
  return vendor === 'recaptcha' || vendor === 'hcaptcha'
}

function authFailure(input: RemediationInput): Remediation {
  return {
    headline: 'Give Forge a working test account, or make one exist in the environment being verified.',
    owner: 'forge',
    steps: [
      'Check the credentials on the project: the login path, the username, and whether that account exists in this environment.',
      'Sign in by hand with them. Most of these findings are an account that was never seeded into the preview environment.',
      'Forge signs in with a username and password only. Single sign-on, magic links, and second factors are not supported, so the account has to be one that gets in with a password.',
      'If no such account can exist, verify the signed-out surface instead and say so in the project plan.',
    ],
    prompt: [
      '# Make a preview environment sign-in-able for automated verification',
      '',
      `Automated verification of ${hostOf(input.run.targetUrl)} could not sign in: ${oneLine(input.finding.description)}`,
      '',
      'The agent posts a username and password to a login form. It cannot complete single sign-on, a magic link, or a second factor.',
      '',
      section('What I want you to do', [
        '1. Find how accounts are seeded for this environment, and whether a dedicated verification account exists.',
        '2. If it does not, add one to the seed or migration path that creates it: password sign-in, no second factor, and only the permissions the journeys need.',
        '3. Keep its password out of the repository. Read it from the environment the same way every other secret is read.',
        '4. Tell me the login path, the username, and where the password is set, so the project can be configured with it.',
      ]),
      '',
      section('Rules', [
        '- Do not disable authentication, and do not add a bypass that works without credentials.',
        '- Do not weaken password or session rules for real users to make this easier.',
        '- If the environment cannot hold a test account at all, say so and stop.',
      ]),
    ].join('\n'),
  }
}

function unreachable(input: RemediationInput): Remediation {
  return {
    headline: 'The target did not answer in time. Confirm it is up and reachable from outside your network.',
    owner: 'infrastructure',
    steps: [
      `Request ${hostOf(input.run.targetUrl)} from somewhere outside your own network and time it.`,
      'Check the deployment is finished and the hostname resolves to it, not to a placeholder or an old origin.',
      'If it answers but slowly, treat the latency as the finding: a page that takes longer than a browser will wait is broken for users too.',
      'Re-run the verification once the target answers.',
    ],
    prompt: [
      brief(input),
      section('What I want you to do', [
        '1. Establish whether the target is reachable and how long it takes to answer, from outside our own network.',
        '2. If it is unreachable, find out why: deployment, DNS, certificate, origin health.',
        '3. If it is reachable but slow, find what takes the time and tell me whether it is fixable in the application.',
        '4. Report the cause. Do not change application code unless the cause is in it.',
      ]),
      RULES,
    ].join('\n\n'),
  }
}

function environment(input: RemediationInput): Remediation {
  return {
    headline: 'The environment refused the traffic - most often a rate limit. Re-run, or raise the limit for this origin.',
    owner: 'infrastructure',
    steps: [
      'Check whether a rate limit or quota was hit at the time of the run.',
      'A preview environment that rate-limits a handful of page loads will fail every verification, not just this one.',
      'Raise the limit for that hostname, or schedule runs so they do not collide.',
      'Re-run the verification.',
    ],
    prompt: [
      brief(input),
      section('What I want you to do', [
        '1. Find the limit that was hit: which rule, at which layer, for which hostname.',
        '2. Tell me whether it applies to the preview environment only, or to production as well.',
        '3. Propose the smallest configuration change that lets verification traffic through without changing what real users get.',
      ]),
      RULES,
    ].join('\n\n'),
  }
}

/** Forge broke, not the application. Nothing to hand an agent. */
function agentError(): Remediation {
  return {
    headline: 'Nothing to fix in your application: the verification run itself failed.',
    owner: 'none',
    steps: [
      'Re-run the verification. Browser and agent faults rarely repeat.',
      'If it keeps happening on the same journey, the run is the thing to report, not the application.',
    ],
    prompt: null,
  }
}

/* ------------------------------------------------------------- assembly */

const RULES = section('Rules', [
  '- Do not change tests, assertions, fixtures or verification configuration to make the failure go away.',
  '- Do not widen the change beyond this failure. If you find other problems, list them; do not fix them here.',
  '- If the fix needs a product decision, stop and describe the options rather than choosing one.',
  '- If the evidence is not enough to find the cause, say what else you would need instead of guessing.',
])

/** The evidence half of a brief: everything the run saw, and nothing more. */
function brief(input: RemediationInput): string {
  const { finding, journey, steps, run } = input
  const lines: string[] = [
    `# Fix: ${finding.title}`,
    '',
    `An automated verification run against ${run.targetUrl} produced this. Everything below is what the run observed; there is no other evidence.`,
  ]

  if (journey) {
    lines.push(
      '',
      '## Journey',
      `${journey.name} - ${journey.goal}`,
      `Entry path: ${journey.entryPath}`,
    )
  }

  lines.push('', '## What the run saw', oneLine(finding.description))

  if (steps.length > 0) {
    lines.push('', '## Steps, as they happened')
    let n = 0
    for (const step of steps) {
      n += 1
      const mark =
        step.status === 'failed' ? 'FAIL' : step.status === 'skipped' ? 'SKIP' : 'OK'
      const target = step.target ? ` "${step.target}"` : ''
      lines.push(`${n}. [${mark}] ${step.action}${target}`)
      if (step.expected) lines.push(`   expected: ${step.expected}`)
      if (step.actual) lines.push(`   actual: ${step.actual}`)
    }
  }

  lines.push('', '## Verdict', `Severity: ${finding.severity}.`)
  lines.push(
    finding.reproductionAttempts > 0
      ? `Reproduced on ${finding.reproductionFailures} of ${finding.reproductionAttempts} attempts.`
      : 'Not reproduced: this was recorded from a single observation.',
  )
  if (run.executor === 'fetch') {
    lines.push(
      'Verified with the HTTP executor, so no JavaScript ran. A client-rendered page will look emptier here than it is in a browser.',
    )
  }
  if (finding.rootCause) {
    lines.push('', '## Proposed root cause (a lead, not a conclusion)', finding.rootCause)
  }
  if (finding.affectedFiles.length > 0) {
    lines.push('', '## Files the source investigation touched')
    for (const file of finding.affectedFiles) lines.push(`- ${file}`)
  }

  return lines.join('\n')
}

function section(title: string, lines: readonly string[]): string {
  return [`## ${title}`, ...lines].join('\n')
}

/** Keeps a description on one line inside a prompt that is read as Markdown. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
