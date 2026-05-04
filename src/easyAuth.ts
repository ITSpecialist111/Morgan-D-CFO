import type { NextFunction, Request, Response } from 'express';
import { getWebSessionFromCookieHeader, getWebSessionFromRequest } from './webSession';

export interface EasyAuthPrincipal {
  oid?: string;
  email?: string;
  name?: string;
  tenantId?: string;
  claims: Array<{ typ: string; val: string }>;
}

interface RawPrincipal {
  claims?: Array<{ typ: string; val: string }>;
}

export function browserAuthRequired(): boolean {
  if (process.env.WEB_AUTH_REQUIRED === 'false') return false;
  return process.env.NODE_ENV !== 'development';
}

export function decodePrincipal(headerValue: string | string[] | undefined): EasyAuthPrincipal | null {
  const encoded = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!encoded) return null;
  try {
    const raw = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as RawPrincipal;
    const claims = raw.claims || [];
    const find = (...types: string[]): string | undefined => claims.find((claim) => types.includes(claim.typ))?.val;
    return {
      oid: find('http://schemas.microsoft.com/identity/claims/objectidentifier', 'oid'),
      email: find(
        'preferred_username',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
        'email',
      ),
      name: find('name', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'),
      tenantId: find('http://schemas.microsoft.com/identity/claims/tenantid', 'tid'),
      claims,
    };
  } catch {
    return null;
  }
}

export function loginUrlFor(path = '/mission-control'): string {
  return `/auth/login?returnTo=${encodeURIComponent(path)}`;
}

export function getPrincipalFromHeaders(headers: Record<string, string | string[] | undefined>): EasyAuthPrincipal | null {
  return decodePrincipal(headers['x-ms-client-principal']) || getWebSessionFromCookieHeader(headers.cookie);
}

export function getRequestPrincipal(req: Request): EasyAuthPrincipal | null {
  return decodePrincipal(req.header('X-MS-CLIENT-PRINCIPAL')) || getWebSessionFromRequest(req);
}

export function requireEasyAuth(
  req: Request & { easyAuthPrincipal?: EasyAuthPrincipal },
  res: Response,
  next: NextFunction,
): void {
  if (!browserAuthRequired()) {
    req.easyAuthPrincipal = { oid: 'local-development', name: 'Local developer', claims: [] };
    next();
    return;
  }

  const principal = getRequestPrincipal(req);
  if (!principal?.oid) {
    res.status(401).json({ error: 'Unauthorized', loginUrl: loginUrlFor(req.originalUrl || '/mission-control') });
    return;
  }

  const expectedTenant = process.env.MicrosoftAppTenantId || process.env.MICROSOFT_APP_TENANTID;
  if (expectedTenant && principal.tenantId && principal.tenantId !== expectedTenant) {
    res.status(403).json({ error: 'Forbidden - tenant mismatch' });
    return;
  }

  req.easyAuthPrincipal = principal;
  next();
}