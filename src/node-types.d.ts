/**
 * Minimal ambient declarations for Node.js built-ins used in this package.
 * Added to avoid requiring @types/node as a devDependency.
 */
declare module 'node:async_hooks' {
  class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R
    getStore(): T | undefined
    enterWith(store: T): void
    disable(): void
  }

  export { AsyncLocalStorage }
}
