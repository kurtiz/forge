/**
 * The run the film shows.
 *
 * Deterministic on purpose. The video must not depend on a live agent, because
 * an agent that takes a different path on a Tuesday would silently change the
 * cut - and because a trailer needs the same frames every render for the visual
 * QA loop to mean anything.
 *
 * None of it is invented. This is the Northbeam fixture from
 * `apps/web/src/server/demo/app.ts` with its three seeded defects, its real
 * journey names and priorities as they appear in `public/shots/journeys-dark.webp`,
 * and its actual thrown errors - including the file and line the invite failure
 * reports, which is what scene 7 opens.
 */

export type StepStatus = 'ok' | 'fail' | 'skip'

export interface Step {
  status: StepStatus
  action: string
  target?: string
  actual?: string
  expected?: string
}

export interface Journey {
  name: string
  goal: string
  priority: number
  status: 'passed' | 'failed' | 'skipped' | 'running' | 'pending'
  steps: Step[]
}

export const RUN_ID = 'run_8Kq2mVx4nR'
export const TARGET_URL = 'https://forge-demo.workers.dev/demo'
export const PROJECT_NAME = 'Northbeam'
export const COMMIT = 'a91c4f2'

/** Ordered exactly as the Explorer ranks them: priority descending. */
export const JOURNEYS: Journey[] = [
  {
    name: 'Checkout with coupon',
    goal: 'Complete checkout with a coupon',
    priority: 1.0,
    status: 'failed',
    steps: [
      { status: 'ok', action: 'Navigate', target: '/demo/checkout', actual: 'Opened /demo/checkout (200)' },
      { status: 'ok', action: 'Fill', target: 'you@company.com', actual: 'Typed into "you@company.com".' },
      { status: 'ok', action: 'Fill', target: '4242 4242 4242 4242', actual: 'Typed into "4242 4242 4242 4242".' },
      { status: 'fail', action: 'Submit', target: 'Complete purchase', actual: 'Submitted the form from "Complete purchase".' },
    ],
  },
  {
    name: 'Invite teammate',
    goal: 'Successfully invite a teammate',
    priority: 0.95,
    status: 'failed',
    steps: [
      { status: 'ok', action: 'Navigate', target: '/demo/invite', actual: 'Opened /demo/invite (200)' },
      { status: 'ok', action: 'Fill', target: 'teammate@company.com', actual: 'Typed into "teammate@company.com".' },
      {
        status: 'fail',
        action: 'Submit',
        target: 'Send invite',
        expected: 'Invitation sent',
        actual: 'HTTP 500 from POST /demo/invite',
      },
    ],
  },
  {
    name: 'View pricing',
    goal: 'View current pricing information',
    priority: 0.2,
    status: 'failed',
    steps: [
      { status: 'fail', action: 'Navigate', target: '/demo/pricing', actual: 'Opened /demo/pricing (404)' },
    ],
  },
  {
    name: 'Access dashboard',
    goal: 'View dashboard information',
    priority: 0.1,
    status: 'skipped',
    steps: [
      { status: 'ok', action: 'Navigate', target: '/demo', actual: 'Opened /demo (200)' },
      { status: 'skip', action: 'Locate control', target: 'Access dashboard', actual: 'No matching control was found on the page.' },
    ],
  },
]

/** The journey the film follows all the way to a verified fix. */
export const HERO_JOURNEY = JOURNEYS[1]

export const FINDING = {
  title: 'Inviting a teammate outside the org domain returns HTTP 500',
  severity: 'High',
  classification: 'Confirmed bug',
  failureClass: 'Application bug',
  reproductionAttempts: 5,
  reproductionFailures: 5,
  confidence: 0.94,
  rootCauseConfidence: 0.88,
  rootCause:
    'The invitation mailer only registers an "internal" transport. An address outside the org domain resolves to "external", which is not in the registry, so the lookup returns undefined and the send throws before any mail is queued.',
  affectedFile: 'src/server/invitations/send.ts',
  affectedLine: 22,
} as const

/** Verbatim, as the fixture throws it. */
export const ERROR_TEXT = 'Error: mailer transport "external" is not registered'
export const ERROR_FRAME = 'at sendInvitation (src/server/invitations/send.ts:22)'

/**
 * The source the Solari sandbox surfaces. Line numbers are absolute so the
 * highlight in scene 7 lands on the line the stack trace names.
 */
export const SOURCE_LINES: Array<{ n: number; code: string }> = [
  { n: 16, code: 'const transports: Record<string, Transport> = {' },
  { n: 17, code: "  internal: internalMailer," },
  { n: 18, code: '}' },
  { n: 19, code: '' },
  { n: 20, code: 'export async function sendInvitation(invite: Invite) {' },
  { n: 21, code: '  const channel = resolveChannel(invite.email)' },
  { n: 22, code: '  const transport = transports[channel]' },
  { n: 23, code: '' },
  { n: 24, code: '  return transport.send({' },
  { n: 25, code: '    to: invite.email,' },
  { n: 26, code: '    template: "team-invite",' },
  { n: 27, code: '  })' },
  { n: 28, code: '}' },
]

/** Six artifacts, in the order the Judge attaches them. */
export const EVIDENCE = [
  { kind: 'screenshot', label: 'Invite teammate: failure', size: '148 KB' },
  { kind: 'recording', label: 'Session recording', size: '2.4 MB' },
  { kind: 'console', label: 'Console errors: Invite teammate', size: '69 B' },
  { kind: 'network', label: 'Network errors: Invite teammate', size: '212 B' },
  { kind: 'action', label: 'Agent trace: Invite teammate', size: '293 B' },
  { kind: 'source', label: 'Source: src/server/invitations/send.ts', size: '1.1 KB' },
] as const

/** The run's phase rail. Terminal states are not phases. */
export const PHASES = [
  'Queued',
  'Starting',
  'Discovering',
  'Testing',
  'Investigating',
  'Reporting',
] as const

/** Agent trace lines, as the RunSessionDO streams them. */
export const TRACE = [
  { t: '14:02:07', tone: 'idle', message: 'Run queued' },
  { t: '14:02:08', tone: 'live', message: 'Solari browser session opened' },
  { t: '14:02:11', tone: 'live', message: 'Explorer mapped 6 reachable pages' },
  { t: '14:02:19', tone: 'live', message: 'Discovered 4 journeys' },
  { t: '14:02:24', tone: 'live', message: 'Operator running: Invite teammate' },
  { t: '14:02:31', tone: 'fail', message: 'Journey failed: Invite teammate' },
  { t: '14:02:33', tone: 'live', message: 'Reproducing failure, 5 attempts' },
  { t: '14:02:58', tone: 'fail', message: 'Reproduced 5 of 5' },
  { t: '14:03:02', tone: 'live', message: 'Solari sandbox: cloned repository' },
  { t: '14:03:14', tone: 'fail', message: 'Finding created: confidence 0.94' },
] as const
