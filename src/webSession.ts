import crypto from 'crypto';
import type { Request, Response } from 'express';

export interface WebAuthPrincipal {
  oid?: string;
  email?: string;
  name?: string;
  tenantId?: string;
  claims: Array<{ typ: string; val: string }>;
  provider?: string;
}

export interface WebAuthState {
  state: string;
  returnTo: string;
}

const SESSION_COOKIE = 'morgan_auth_session';
const STATE_COOKIE = 'morgan_auth_state';
const developmentSessionSecret = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string | null {
  return (
    process.env.MORGAN_WEB_SESSION_SECRET ||
    process.env.EASYAUTH_MICROSOFT_CLIENT_SECRET ||
    process.env.MicrosoftAppPassword ||
    process.env.MICROSOFT_APP_PASSWORD ||
    (process.env.NODE_ENV === 'development' ? developmentSessionSecret : null)
  );
}

function maxAgeSeconds(envName: string, fallbackSeconds: number): number {
  const parsed = Number(process.env[envName]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds;
}

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeSignedValue<T>(value: T, ttlSeconds: number): string {
  const secret = getSigningSecret();
  if (!secret) throw new Error('MORGAN_WEB_SESSION_SECRET is required for browser sign-in.');
  const payload = Buffer.from(JSON.stringify({ value, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function decodeSignedValue<T>(signedValue: string | undefined): T | null {
  const secret = getSigningSecret();
  if (!secret || !signedValue) return null;
  const [payload, signature] = signedValue.split('.');
  if (!payload || !signature || !signaturesMatch(sign(payload, secret), signature)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { value?: T; exp?: number };
    if (!decoded.exp || decoded.exp < Date.now()) return null;
    return decoded.value || null;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | string[] | undefined): Record<string, string> {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader;
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const index = part.indexOf('=');
    if (index <= 0) return cookies;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function appendSetCookie(res: Response, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookie]);
  } else if (typeof existing === 'string') {
    res.setHeader('Set-Cookie', [existing, cookie]);
  } else {
    res.setHeader('Set-Cookie', cookie);
  }
}

function cookieAttributes(maxAgeSecondsValue?: number): string {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV !== 'development') attributes.push('Secure');
  if (maxAgeSecondsValue !== undefined) attributes.push(`Max-Age=${Math.floor(maxAgeSecondsValue)}`);
  return attributes.join('; ');
}

function setSignedCookie<T>(res: Response, name: string, value: T, ttlSeconds: number): void {
  const encoded = encodeURIComponent(encodeSignedValue(value, ttlSeconds));
  appendSetCookie(res, `${name}=${encoded}; ${cookieAttributes(ttlSeconds)}`);
}

function clearCookie(res: Response, name: string): void {
  appendSetCookie(res, `${name}=; ${cookieAttributes(0)}`);
}

export function getWebSessionFromCookieHeader(cookieHeader: string | string[] | undefined): WebAuthPrincipal | null {
  return decodeSignedValue<WebAuthPrincipal>(parseCookies(cookieHeader)[SESSION_COOKIE]);
}

export function getWebSessionFromRequest(req: Request): WebAuthPrincipal | null {
  return getWebSessionFromCookieHeader(req.headers.cookie);
}

export function setWebSessionCookie(res: Response, principal: WebAuthPrincipal): void {
  setSignedCookie(res, SESSION_COOKIE, principal, maxAgeSeconds('WEB_SESSION_MAX_AGE_SECONDS', 8 * 60 * 60));
}

export function clearWebSessionCookie(res: Response): void {
  clearCookie(res, SESSION_COOKIE);
}

export function setWebAuthStateCookie(res: Response, state: WebAuthState): void {
  setSignedCookie(res, STATE_COOKIE, state, maxAgeSeconds('WEB_AUTH_STATE_MAX_AGE_SECONDS', 10 * 60));
}

export function getWebAuthStateFromRequest(req: Request): WebAuthState | null {
  return decodeSignedValue<WebAuthState>(parseCookies(req.headers.cookie)[STATE_COOKIE]);
}

export function clearWebAuthStateCookie(res: Response): void {
  clearCookie(res, STATE_COOKIE);
}