/**
 * StorageProvider adapter interface.
 *
 * Abstracts persistent storage for work cards, approvals, memory snapshots,
 * and task records. Implementations can target Cosmos DB, file system,
 * Dataverse, Redis, or in-memory maps.
 *
 * Pattern: the same provider pattern as @microsoft/agents-hosting Storage
 * (read / write / delete), extended with typed domain keys.
 */

/** Raw key-value storage interface — the base layer. */
export interface RawStorage {
  read(keys: string[]): Promise<Record<string, unknown>>;
  write(changes: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<void>;
}

/**
 * Domain-typed storage provider used by the WorkLoop and its sub-systems.
 * Implement this interface or use the built-in InMemoryStorageProvider.
 */
export interface StorageProvider {
  /** Persist an arbitrary domain object under a namespaced key. */
  set(namespace: string, key: string, value: unknown): Promise<void>;
  /** Retrieve a domain object by namespace and key. */
  get<T = unknown>(namespace: string, key: string): Promise<T | undefined>;
  /** List all keys in a namespace. */
  listKeys(namespace: string): Promise<string[]>;
  /** Remove a domain object. */
  remove(namespace: string, key: string): Promise<void>;
  /** Human-readable backend name for logging. */
  readonly backendName: string;
}
