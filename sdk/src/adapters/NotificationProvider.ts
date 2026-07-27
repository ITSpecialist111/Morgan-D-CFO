/**
 * NotificationProvider adapter interface.
 *
 * Abstracts outbound notification channels so the SDK is not coupled to
 * Microsoft Teams, email, or any particular delivery system.
 * Implementations can target Teams, Slack, email SMTP, Webhooks, etc.
 */

export interface NotificationMessage {
  /** Primary human-readable body. */
  text: string;
  /** Optional rich card payload (e.g. Adaptive Card JSON). */
  card?: Record<string, unknown>;
  /** Subject line for email-style channels. */
  subject?: string;
}

export interface NotificationResult {
  ok: boolean;
  channel: string;
  messageId?: string;
  error?: string;
}

/**
 * Implement this interface to wire in a notification channel.
 * The WorkLoop uses it when broadcasting cycle digests and HITL requests.
 */
export interface NotificationProvider {
  /**
   * Send a notification to a named target (email address, channel ID, user ID, etc.).
   * Should not throw; return ok:false on delivery failure.
   */
  send(target: string, message: NotificationMessage): Promise<NotificationResult>;
  /** Human-readable channel name for logging (e.g. "Microsoft Teams", "Email"). */
  readonly channelName: string;
}
