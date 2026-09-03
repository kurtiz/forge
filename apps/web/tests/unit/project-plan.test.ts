/**
 * The plan a project sets for itself.
 *
 * These schemas are the boundary between a form and the database, and every
 * one of the transforms below exists because a form sends something the
 * database should not store as-is: a path without its leading slash, a
 * priority outside the scale, an empty box that means "clear this" in one
 * place and "leave it alone" in another.
 */
import { describe, expect, it } from 'vitest'
import {
  createProjectJourneyInputSchema,
  createSampleValueInputSchema,
  updateProjectInputSchema,
} from '@/server/contracts'

describe('planning a journey', () => {
  const parse = (patch: Record<string, unknown>) =>
    createProjectJourneyInputSchema.parse({
      projectId: 'prj_1',
      name: 'Add a referral',
      ...patch,
    })

  it('makes the entry path a path', () => {
    expect(parse({ entryPath: 'referrals' }).entryPath).toBe('/referrals')
    expect(parse({ entryPath: '/referrals' }).entryPath).toBe('/referrals')
    // Nothing given is the site root, not an empty string the run would
    // resolve against the target URL and land somewhere unpredictable.
    expect(parse({}).entryPath).toBe('/')
    expect(parse({ entryPath: '  ' }).entryPath).toBe('/')
  })

  it('holds the priority to the scale the rest of the system uses', () => {
    // Clamped rather than rejected: a project that sent 1.4 meant "the most
    // important one", and refusing the whole request would be pedantry.
    expect(parse({ priority: 1.4 }).priority).toBe(1)
    expect(parse({ priority: -2 }).priority).toBe(0)
    expect(parse({ priority: 0.833 }).priority).toBe(0.83)
    expect(parse({}).priority).toBe(0.5)
  })

  it('accepts a journey with no goal, because the name is what is matched', () => {
    expect(parse({}).goal).toBe('')
  })

  it('will not take a journey with no name', () => {
    expect(() =>
      createProjectJourneyInputSchema.parse({ projectId: 'prj_1', name: 'x' }),
    ).toThrow()
  })
})

describe('a sample value', () => {
  it('needs both the field it is for and something to type', () => {
    expect(() =>
      createSampleValueInputSchema.parse({
        projectId: 'prj_1',
        label: 'Phone number',
        value: '',
      }),
    ).toThrow()
    expect(() =>
      createSampleValueInputSchema.parse({
        projectId: 'prj_1',
        label: '',
        value: '0244123456',
      }),
    ).toThrow()
  })
})

describe("editing a project's stated priority", () => {
  const parse = (patch: Record<string, unknown>) =>
    updateProjectInputSchema.parse({ projectId: 'prj_1', ...patch })

  it('tells "leave it alone" apart from "clear it"', () => {
    /*
     * The preview URL pattern and the stated priority are edited from
     * different parts of the page, and each sends only its own field. Without
     * this distinction, saving one would blank the other.
     */
    expect(parse({}).goal).toBeUndefined()
    expect(parse({ goal: '' }).goal).toBeNull()
    expect(parse({ goal: '  ' }).goal).toBeNull()
    expect(parse({ goal: '  Checkout must work  ' }).goal).toBe('Checkout must work')
  })
})
