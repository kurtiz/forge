import { describe, expect, it } from 'vitest'
import {
  cleanupMessageSchema,
  MAX_PASSES,
  RUNS_PER_PASS,
} from '@/server/cleanup/messages'

describe('cleanupMessageSchema', () => {
  it('accepts a deletion message and defaults the pass', () => {
    const parsed = cleanupMessageSchema.parse({
      type: 'project.delete',
      projectId: 'prj_abc123',
    })

    expect(parsed.pass).toBe(0)
  })

  it('rejects a message from a different shape of queue', () => {
    // A queue message is written by one deployment and read by another,
    // possibly a version later. One that no longer parses has to be refused
    // rather than acted on half-understood.
    for (const body of [
      null,
      'project.delete',
      { type: 'project.delete' },
      { type: 'run.delete', projectId: 'prj_abc123' },
      { type: 'project.delete', projectId: '' },
    ]) {
      expect(cleanupMessageSchema.safeParse(body).success).toBe(false)
    }
  })

  it('refuses a pass count beyond the ceiling', () => {
    expect(
      cleanupMessageSchema.safeParse({
        type: 'project.delete',
        projectId: 'prj_abc123',
        pass: MAX_PASSES + 1,
      }).success,
    ).toBe(false)
  })

  it('bounds the work a single pass can take on', () => {
    // The pass size is what keeps a project with a long history from exceeding
    // a consumer's time budget, and the ceiling is what stops a bug from
    // cycling forever. Both only work if they stay small and finite.
    expect(RUNS_PER_PASS).toBeGreaterThan(0)
    expect(RUNS_PER_PASS).toBeLessThanOrEqual(50)
    expect(MAX_PASSES * RUNS_PER_PASS).toBeGreaterThan(1000)
  })
})
