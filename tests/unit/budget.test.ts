import { describe, expect, it } from 'vitest'
import { Budget, BudgetExceededError } from '#/server/domain/budget'
import { DEFAULT_BUDGET } from '#/server/contracts'

const limits = { ...DEFAULT_BUDGET, maxAiCalls: 2, maxBrowserActions: 3 }

describe('Budget', () => {
  it('permits spending up to the limit', () => {
    const budget = new Budget(limits)
    budget.spend('aiCalls')
    budget.spend('aiCalls')
    expect(budget.usage.aiCalls).toBe(2)
  })

  it('throws once the limit is reached', () => {
    const budget = new Budget(limits)
    budget.spend('browserActions', 3)
    expect(() => budget.spend('browserActions')).toThrow(BudgetExceededError)
  })

  it('reports affordability without spending', () => {
    const budget = new Budget(limits)
    budget.spend('aiCalls', 2)
    expect(budget.canSpend('aiCalls')).toBe(false)
    expect(budget.usage.aiCalls).toBe(2)
  })

  it('names the exhausted resource', () => {
    const budget = new Budget(limits)
    budget.spend('aiCalls', 2)
    try {
      budget.spend('aiCalls')
      throw new Error('expected the budget to refuse')
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExceededError)
      expect((error as BudgetExceededError).resource).toBe('aiCalls')
    }
  })

  it('tracks resources independently', () => {
    const budget = new Budget(limits)
    budget.spend('aiCalls', 2)
    expect(budget.canSpend('browserActions')).toBe(true)
  })

  it('is not expired at the start of a run', () => {
    expect(new Budget(limits).expired).toBe(false)
  })
})
