/**
 * Run budget enforcement.
 *
 * Every Solari session and every model call costs money, so the ceiling is
 * enforced by application code rather than trusted to the agent loop.
 */
import type { AgentBudget } from '../contracts'

export type BudgetUsage = {
  aiCalls: number
  browserActions: number
  browserSeconds: number
  evidenceBytes: number
  sandboxSeconds: number
}

export class BudgetExceededError extends Error {
  constructor(readonly resource: keyof BudgetUsage) {
    super(`Run budget exceeded: ${resource}`)
    this.name = 'BudgetExceededError'
  }
}

export class Budget {
  readonly usage: BudgetUsage = {
    aiCalls: 0,
    browserActions: 0,
    browserSeconds: 0,
    evidenceBytes: 0,
    sandboxSeconds: 0,
  }

  private readonly startedAt = Date.now()

  constructor(private readonly limits: AgentBudget) {}

  private get elapsedSeconds() {
    return Math.round((Date.now() - this.startedAt) / 1000)
  }

  /** Throws when the resource is already spent. Call before doing the work. */
  spend(resource: keyof BudgetUsage, amount = 1): void {
    if (!this.canSpend(resource, amount)) {
      throw new BudgetExceededError(resource)
    }
    this.usage[resource] += amount
  }

  canSpend(resource: keyof BudgetUsage, amount = 1): boolean {
    const next = this.usage[resource] + amount
    switch (resource) {
      case 'aiCalls':
        return next <= this.limits.maxAiCalls
      case 'browserActions':
        return next <= this.limits.maxBrowserActions
      case 'browserSeconds':
        return this.elapsedSeconds + amount <= this.limits.maxBrowserSeconds
      case 'evidenceBytes':
        return next <= this.limits.maxEvidenceBytes
      case 'sandboxSeconds':
        // Unlike browser time, this is not derived from run-elapsed time: the
        // sandbox is open for part of a run, so its cost is spent explicitly.
        return next <= this.limits.maxSandboxSeconds
    }
  }

  /** True once wall-clock time alone should end the run. */
  get expired(): boolean {
    return this.elapsedSeconds >= this.limits.maxBrowserSeconds
  }

  snapshot(): BudgetUsage & { elapsedSeconds: number } {
    return { ...this.usage, elapsedSeconds: this.elapsedSeconds }
  }
}
