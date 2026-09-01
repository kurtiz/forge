/**
 * Run state machine.
 *
 * The only place a run status is allowed to change shape. Kept free of I/O so
 * it can be unit tested without a Worker runtime.
 */
import type { RunStatus } from '../contracts'

const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['starting', 'canceled', 'failed'],
  starting: ['discovering', 'canceled', 'failed'],
  discovering: ['testing', 'reporting', 'canceled', 'failed'],
  testing: ['investigating', 'reporting', 'canceled', 'failed'],
  investigating: ['reporting', 'canceled', 'failed'],
  reporting: ['completed', 'canceled', 'failed'],
  completed: [],
  failed: [],
  canceled: [],
}

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(status: RunStatus): boolean {
  return TRANSITIONS[status].length === 0
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal run transition: ${from} -> ${to}`)
  }
}

/** Ordered phases shown in the UI progress rail. Terminal states excluded. */
export const RUN_PHASES = [
  'queued',
  'starting',
  'discovering',
  'testing',
  'investigating',
  'reporting',
] as const satisfies readonly RunStatus[]

export function phaseIndex(status: RunStatus): number {
  const i = RUN_PHASES.indexOf(status as (typeof RUN_PHASES)[number])
  if (i >= 0) return i
  return status === 'completed' ? RUN_PHASES.length : -1
}
