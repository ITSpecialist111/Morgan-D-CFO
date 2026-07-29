/**
 * Built-in adapter implementations.
 * Consumers may replace any of these with production adapters.
 */

export { InMemoryStorageProvider } from './InMemoryStorageProvider';
export { ConsoleNotificationProvider } from './ConsoleNotificationProvider';
export type { LlmProvider, LlmMessage, LlmCompletionOptions, LlmCompletionResult } from './LlmProvider';
export type { StorageProvider } from './StorageProvider';
export type { NotificationProvider, NotificationMessage, NotificationResult } from './NotificationProvider';
