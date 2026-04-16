import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestStore {
  key?: string
  estimatedTokens?: number
}

const als = new AsyncLocalStorage<RequestStore>()

/**
 * AsyncLocalStorage-backed context for per-request data.
 *
 * Provides isolation between concurrent requests — each `run()` call
 * creates its own context that is not visible to other concurrent calls.
 *
 * @example
 * RequestContext.run({ key: 'sk-...' }, async () => {
 *   const store = RequestContext.getStore()
 *   // store.key === 'sk-...'
 * })
 */
export const RequestContext = {
  /**
   * Runs `fn` within a new context scoped to `store`.
   * The store is accessible via {@link getStore} anywhere inside `fn`
   * (including nested async calls), but not outside.
   */
  run<T>(store: RequestStore, fn: () => T): T {
    return als.run(store, fn)
  },

  /**
   * Returns the store for the current asynchronous context,
   * or `undefined` if called outside a {@link run} scope.
   */
  getStore(): RequestStore | undefined {
    return als.getStore()
  },
} as const
