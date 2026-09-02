import { describe, expect, it } from 'vitest'
import { initialsFor } from '#/components/app/account-menu'

describe('initialsFor', () => {
  it('takes the initials of a full name', () => {
    expect(initialsFor({ name: 'Ines Caetano', email: 'i@example.com' })).toBe('IC')
  })

  it('falls back to the email when there is no name', () => {
    expect(initialsFor({ name: '   ', email: 'nadia.okonjo@example.com' })).toBe(
      'NO',
    )
  })

  it('handles a single word', () => {
    expect(initialsFor({ name: 'Forge', email: 'f@example.com' })).toBe('FO')
  })

  it('never returns an empty label', () => {
    expect(initialsFor({ name: '', email: '' })).toBe('?')
  })
})
