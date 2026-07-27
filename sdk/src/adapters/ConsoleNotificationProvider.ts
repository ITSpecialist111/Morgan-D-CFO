import type { NotificationProvider, NotificationMessage, NotificationResult } from './NotificationProvider';

/**
 * Built-in console notification provider.
 * Useful for local development and testing; logs messages to stdout.
 */
export class ConsoleNotificationProvider implements NotificationProvider {
  readonly channelName = 'console';

  async send(target: string, message: NotificationMessage): Promise<NotificationResult> {
    console.log(`[CorpGen Notification] → ${target}`);
    if (message.subject) console.log(`  Subject: ${message.subject}`);
    console.log(`  ${message.text}`);
    return { ok: true, channel: 'console' };
  }
}
