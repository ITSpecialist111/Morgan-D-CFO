import type { StorageProvider } from './StorageProvider';

/**
 * Built-in in-memory storage provider.
 * Suitable for testing and demo scenarios. Resets when the process restarts.
 *
 * NB3 fix: values are deep-cloned on set and get using structuredClone so
 * that callers cannot mutate the authoritative stored copy by reference.
 * This is critical for security-sensitive records such as HITL approvals.
 */
export class InMemoryStorageProvider implements StorageProvider {
  readonly backendName = 'in-memory';
  private readonly store = new Map<string, unknown>();

  private key(namespace: string, key: string): string {
    return `${namespace}::${key}`;
  }

  async set(namespace: string, key: string, value: unknown): Promise<void> {
    // Clone on write so the stored copy is independent of the caller's object.
    this.store.set(this.key(namespace, key), structuredClone(value));
  }

  async get<T = unknown>(namespace: string, key: string): Promise<T | undefined> {
    const value = this.store.get(this.key(namespace, key));
    if (value === undefined) return undefined;
    // Clone on read so the caller cannot mutate the stored copy.
    return structuredClone(value) as T;
  }

  async listKeys(namespace: string): Promise<string[]> {
    const prefix = `${namespace}::`;
    const keys: string[] = [];
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) keys.push(k.slice(prefix.length));
    }
    return keys;
  }

  async remove(namespace: string, key: string): Promise<void> {
    this.store.delete(this.key(namespace, key));
  }
}
