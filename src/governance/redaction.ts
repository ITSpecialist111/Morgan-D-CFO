const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|passphrase|api[-_]?key|client[-_]?secret|connection[-_]?string|access[-_]?key|private[-_]?key)/i;
const CONTENT_KEYS = new Set(['promptPreview', 'responsePreview', 'message', 'bodyPreview', 'rationale', 'reasoningSummary']);

export function redactText(value: string, limit = 2048): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:code|token|secret|sig)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi, '[email]@$1')
    .slice(0, limit);
}

export function sanitizeTelemetryValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (depth > 5) return '[MAX_DEPTH]';
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactText(value, CONTENT_KEYS.has(key) ? 700 : 2048);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeTelemetryValue(item, key, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([childKey, item]) => [childKey, sanitizeTelemetryValue(item, childKey, depth + 1)]),
    );
  }
  return redactText(String(value));
}

export function sanitizeTelemetryData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  return data ? sanitizeTelemetryValue(data) as Record<string, unknown> : undefined;
}
