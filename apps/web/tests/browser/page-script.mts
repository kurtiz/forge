/**
 * The page scripts, in a real browser.
 *
 * Everything in `page-script.ts` is a string evaluated inside the target page,
 * so no type checker and no unit test ever looks at it. That is not a
 * theoretical gap: it is where a ref quietly resolved to a hidden day cell
 * left over from a popover that had already closed, and the click meant for a
 * checkbox went there instead, with the run reporting success.
 *
 * Not part of `pnpm test`, because it needs Chrome on the machine. Run it when
 * anything in `page-script.ts` changes:
 *
 *     pnpm test:browser
 *
 * The fixture is the referral form that produced the failure this exists for:
 * a lookup that resolves a patient, a date popover that opens on `pointerdown`
 * alone, a native date input, a select, an ARIA checkbox, and a submit button
 * the application disables until the rest is satisfied.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chooseRevealed, revealedElements } from '@/server/agent/operator'
import type { PageObservation } from '@/server/execution/types'
import {
  checkScript,
  clickScript,
  fillScript,
  OBSERVE_SCRIPT,
  selectScript,
  submitScript,
} from '@/server/execution/page-script'

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.CDP_PORT ?? 9333)

const fixture = fileURLToPath(
  new URL('./fixtures/referral-form.html', import.meta.url),
)
const profile = fileURLToPath(new URL('./.chrome-profile', import.meta.url))

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    `file://${fixture}`,
  ],
  { stdio: 'ignore' },
)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function debuggerUrl(): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = (await (
        await fetch(`http://127.0.0.1:${PORT}/json/list`)
      ).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>
      const target = targets.find(
        (t) => t.type === 'page' && t.url.startsWith('file://'),
      )
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl
    } catch {
      // Chrome is not listening yet.
    }
    await sleep(250)
  }
  throw new Error(`Chrome never came up. Is it at ${CHROME}?`)
}

const socket = new WebSocket(await debuggerUrl())
await new Promise((resolve) => (socket.onopen = resolve))

let nextId = 0
const pending = new Map<number, (message: any) => void>()
socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id) pending.get(message.id)?.(message)
}

async function evaluate<T = string>(expression: string): Promise<T> {
  const id = ++nextId
  const answer = new Promise<any>((resolve) => pending.set(id, resolve))
  socket.send(
    JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }),
  )
  const message = await answer
  if (message.result?.exceptionDetails) {
    throw new Error(JSON.stringify(message.result.exceptionDetails))
  }
  return message.result?.result?.value as T
}

for (let attempt = 0; attempt < 40; attempt++) {
  if ((await evaluate('document.readyState')) === 'complete') break
  await sleep(100)
}

const observe = async (): Promise<PageObservation> => ({
  ...JSON.parse(await evaluate(OBSERVE_SCRIPT)),
  status: 200,
  consoleErrors: [],
  networkErrors: [],
})

const named = (observation: PageObservation, name: string) => {
  const found = observation.elements.find((e) => e.name === name)
  if (!found) throw new Error(`No element named "${name}" on the page.`)
  return found
}

const results: string[] = []
const check = (label: string, passed: boolean, detail = '') =>
  results.push(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`)

/* ------------------------------------------------------------ the page model */

let observation = await observe()
check('the date trigger is a button', named(observation, 'Pick a date').role === 'button')
check('the submit is reported, and disabled', named(observation, 'Send referral').disabled === true)
check(
  'the select carries its options',
  JSON.stringify(named(observation, 'Modality').options) ===
    '["Select a test","Blood test","X-ray"]',
)
check(
  'an ARIA checkbox is a checkbox, not a button',
  named(observation, 'I agree to the terms').role === 'checkbox',
)
check(
  'the date input is a field holding nothing',
  named(observation, 'Preferred date (native)').value === '',
)
check(
  'a closed popover contributes no day cells',
  !observation.elements.some((e) => e.name === '16'),
)

/* ------------------------------------------------------------- typed values */

const native = named(observation, 'Preferred date (native)').ref
check(
  'a date input keeps an ISO date',
  (await evaluate(fillScript(native, '2026-09-16'))) === 'filled:2026-09-16',
)
check(
  'a date input keeps nothing from prose, and says so',
  (await evaluate(fillScript(native, 'Forge verification'))) === 'filled:',
)

/* ------------------------------------------------------------ prerequisites */

observation = await observe()
await evaluate(fillScript(named(observation, 'Phone number').ref, '4155550188'))
await evaluate(fillScript(named(observation, 'Test requested').ref, 'Full blood count'))
await evaluate(clickScript(named(observation, 'Find').ref))

observation = await observe()
check('the lookup resolved a patient', named(observation, 'Patient').value === 'Nadia Okonjo')

const beforePopover = observation
await evaluate(clickScript(named(observation, 'Pick a date').ref))
observation = await observe()

const cells = observation.elements.filter((e) => /^\d{1,2}$/.test(e.name))
check('a popover that opens on pointerdown alone opens', cells.length === 30, `${cells.length} cells`)
check('past days are reported disabled', cells.filter((c) => c.disabled).length === 14)
check('today is marked current', cells.find((c) => c.current)?.name === '15')

const choice = chooseRevealed(revealedElements(beforePopover, observation))
check('the operator chooses the day after today', choice?.name === '16', String(choice?.name))
await evaluate(clickScript(choice!.ref))

/* --------------------------------------------------------- the other verbs */

observation = await observe()
check(
  'an option is chosen by the label the agent can see',
  (await evaluate(selectScript(named(observation, 'Modality').ref, 'Blood test'))) ===
    'filled:Blood test',
)

/*
 * The check below is the one that caught the stale-ref bug: it only fails when
 * a ref resolves to something left over from the popover that has since
 * closed, which is why it runs after the calendar rather than before it.
 */
check(
  'a checkbox turns on',
  (await evaluate(checkScript(named(observation, 'I agree to the terms').ref))) === 'filled:on',
)
check(
  'a checkbox already on is left alone',
  (await evaluate(checkScript(named(observation, 'I agree to the terms').ref))) ===
    'filled:already on',
)

/*
 * A password is reported as full or empty and never as itself. The
 * authenticator types a real credential into one of these, and observations
 * are written to evidence.
 */
observation = await observe()
const pin = named(observation, 'Confirmation PIN').ref
check(
  'a password fill does not echo the password',
  (await evaluate(fillScript(pin, 'hunter2-not-in-evidence'))) === 'filled:set',
)
observation = await observe()
check(
  'a password value is never observed',
  named(observation, 'Confirmation PIN').value === '\u2022\u2022\u2022',
  named(observation, 'Confirmation PIN').value,
)

/* ------------------------------------------------------------- the outcome */

observation = await observe()
check(
  'the submit is enabled once the form is satisfied',
  named(observation, 'Send referral').disabled === undefined,
)
await evaluate(submitScript(named(observation, 'Send referral').ref))
check('the form submitted', (await evaluate<boolean>('window.__submitted === true')) === true)

/*
 * And a form that is not a `form`. Plenty of applications wire their submit to
 * an onClick handler; answering those with "there is nothing to submit"
 * reported a defect where there was only a different way of building a page.
 */
observation = await observe()
await evaluate(submitScript(named(observation, 'Save draft').ref))
check(
  'a page with no form element still submits',
  (await evaluate<boolean>('window.__savedDraft === true')) === true,
)

console.log(results.join('\n'))
const passed = results.every((line) => line.startsWith('PASS'))
console.log(passed ? '\nALL PASS' : '\nFAILURES')

socket.close()
chrome.kill()
process.exit(passed ? 0 : 1)
