import type { StorageProvider } from './StorageProvider';

/**
 * Built-in in-memory storage provider.
 * Suitable for testing and demo scenarios. Resets when the process restarts.
 */
export class InMemoryStorageProvider implements StorageProvider {
  readonly backendName = 'in-memory';
  private readonly store = new Map<string, unknown>();

  private key(namespace: string, key: string): string {
    return `${namespace}::${key}`;
  }

  async set(namespace: string, key: string, value: unknown): Promise<void> {
    this.store.set(this.key(namespace, key), value);
  }

  async get<T = unknown>(namespace: string, key: string): Promise<T | undefined> {
    return this.store.get(this.key(namespace, key)) as T | undefined;
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
