import { describe, expect, it } from 'vitest'
import { getGenerationAttemptStartedAt } from './generation-timing'

describe('generation timing', () => {
  it('uses retry failure creation time when present', () => {
    expect(getGenerationAttemptStartedAt(1000, '2026-01-01T00:00:03.000Z')).toBe(Date.parse('2026-01-01T00:00:03.000Z'))
  })

  it('falls back to original generation start time', () => {
    expect(getGenerationAttemptStartedAt(1000, null)).toBe(1000)
  })
})
