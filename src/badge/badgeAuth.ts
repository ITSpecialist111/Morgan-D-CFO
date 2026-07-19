import crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import type { NextFunction, Request, Response } from 'express';

const MINIMUM_BADGE_KEY_LENGTH = 32;

function configuredBadgeKey(): string | undefined {
  const key = process.env.MORGAN_BADGE_API_KEY?.trim();
  if (!key || key.length < MINIMUM_BADGE_KEY_LENGTH) return undefined;
  if (/<[^>]+>|your-|example|replace-me|optional-/i.test(key)) return undefined;
  return key;
}

function bearerToken(headers: IncomingHttpHeaders): string | undefined {
  const value = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  const match = value?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

function constantTimeMatch(leftValue: string, rightValue: string): boolean {
  const left = Buffer.from(leftValue, 'utf8');
  const right = Buffer.from(rightValue, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function badgeAuthConfigured(): boolean {
  return Boolean(configuredBadgeKey());
}

export function isBadgeRequestAuthorized(headers: IncomingHttpHeaders): boolean {
  const expected = configuredBadgeKey();
  const provided = bearerToken(headers);
  return Boolean(expected && provided && constantTimeMatch(provided, expected));
}

export function requireBadgeAuth(req: Request, res: Response, next: NextFunction): void {
  if (!badgeAuthConfigured()) {
    res.status(503).json({ error: 'Badge authentication is not configured.' });
    return;
  }
  if (!isBadgeRequestAuthorized(req.headers)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Morgan Badge"');
    res.status(401).json({ error: 'Unauthorized badge request.' });
    return;
  }
  next();
}
