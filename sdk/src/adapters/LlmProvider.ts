/**
 * LlmProvider adapter interface.
 *
 * Abstracts the underlying LLM client so the SDK works with Azure OpenAI,
 * OpenAI, Anthropic Claude, or any future provider without changes to core logic.
 *
 * Copilot SDK alignment: The GitHub Copilot SDK hard-wires to the Copilot
 * engine. This interface gives CorpGen SDK the same flexibility that the
 * Copilot Extensions SDK gives when you point it at a custom model endpoint.
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionOptions {
  model?: string;
  messages: LlmMessage[];
  /** Maximum tokens in the response. */
  maxTokens?: number;
  /** Request structured JSON output when true. */
  jsonMode?: boolean;
  /** Abort signal for timeout / cancellation. */
  signal?: AbortSignal;
}

export interface LlmCompletionResult {
  content: string;
  /** Approximate tokens consumed (may be 0 if provider does not report). */
  inputTokens: number;
  outputTokens: number;
  model: string;
  finishReason: 'stop' | 'length' | 'content_filter' | 'error' | string;
}

/**
 * Minimal async interface every LLM provider adapter must implement.
 */
export interface LlmProvider {
  /**
   * Send a chat completion request and return the full response.
   * Throws on unrecoverable errors; callers handle timeouts via AbortSignal.
   */
  complete(options: LlmCompletionOptions): Promise<LlmCompletionResult>;
  /** Human-readable provider name for logging and audit events. */
  readonly providerName: string;
  /** The default model identifier used when options.model is not set. */
  readonly defaultModel: string;
}
