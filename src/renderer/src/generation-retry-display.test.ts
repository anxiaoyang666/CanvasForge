import { describe, expect, it } from 'vitest'
import { shouldShowFailedImageRetryChip, shouldShowRetryAttemptChip } from './generation-retry-display'

describe('generation retry display', () => {
  it('does not show retry chips on final failed images', () => {
    expect(shouldShowFailedImageRetryChip(2)).toBe(false)
  })

  it('shows retry chip while there are attempts left', () => {
    expect(shouldShowRetryAttemptChip({
      retryAttempt: 1,
      maxRetries: 2,
      retryFailure: {
        errorDetails: JSON.stringify({ details: { retryAttempt: 0 } })
      }
    })).toBe(true)
  })

  it('hides retry chip when the last retry has already failed', () => {
    expect(shouldShowRetryAttemptChip({
      retryAttempt: 2,
      maxRetries: 2,
      retryFailure: {
        errorDetails: JSON.stringify({ details: { retryAttempt: 2 } })
      }
    })).toBe(false)
  })
})
