export type TokenCounter = (body: unknown) => number

/**
 * Creates a token estimator function.
 *
 * If a custom counter is provided, it is returned directly.
 * The default estimator sums the character lengths of all string `content`
 * fields in `body.messages` and returns `Math.ceil(totalChars / 4)`.
 *
 * @param customCounter - Optional custom token counting function.
 * @returns A function that estimates token count from a request body.
 *
 * @example
 * const estimate = createTokenEstimator()
 * estimate({ messages: [{ role: 'user', content: 'hello' }] }) // → 2
 */
export function createTokenEstimator(customCounter?: TokenCounter): TokenCounter {
  if (customCounter !== undefined) {
    return customCounter
  }

  return (body: unknown): number => {
    if (!body || typeof body !== 'object') return 0

    const { messages } = body as Record<string, unknown>
    if (!Array.isArray(messages)) return 0

    let totalChars = 0
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue
      const { content } = msg as Record<string, unknown>
      if (typeof content === 'string') {
        totalChars += content.length
      }
    }

    return Math.ceil(totalChars / 4)
  }
}
