import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { ConfidentialClientApplication } from '@azure/msal-node';
import {
  clearWebAuthStateCookie,
  clearWebSessionCookie,
  getWebAuthStateFromRequest,
  getWebSessionFromRequest,
  setWebAuthStateCookie,
  setWebSessionCookie,
  WebAuthPrincipal,
} from './webSession';

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

function safeLocalRedirectPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/mission-control';
  return value;
}

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function tenantId(): string {
  return process.env.MicrosoftAppTenantId || process.env.MICROSOFT_APP_TENANTID || 'common';
}

function clientId(): string | undefined {
  return process.env.MICROSOFT_WEB_CLIENT_ID || process.env.EASYAUTH_MICROSOFT_CLIENT_ID || process.env.MicrosoftAppId || process.env.MICROSOFT_APP_ID;
}

function clientSecret(): string | undefined {
  return process.env.MICROSOFT_WEB_CLIENT_SECRET || process.env.EASYAUTH_MICROSOFT_CLIENT_SECRET || process.env.MicrosoftAppPassword || process.env.MICROSOFT_APP_PASSWORD;
}

function appBaseUrl(req: Request): string {
  const configured = process.env.BASE_URL || process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const forwardedProto = firstQueryValue(req.headers['x-forwarded-proto']) || 'https';
  const forwardedHost = firstQueryValue(req.headers['x-forwarded-host']) || req.headers.host || 'localhost:3978';
  return `${forwardedProto.split(',')[0]}://${String(forwardedHost).split(',')[0]}`;
}

function redirectUri(req: Request): string {
  return `${appBaseUrl(req)}/auth/callback`;
}

function msalClient(): ConfidentialClientApplication {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error('Microsoft web sign-in is missing client ID or client secret configuration.');
  return new ConfidentialClientApplication({
    auth: {
      clientId: id,
      clientSecret: secret,
      authority: `https://login.microsoftonline.com/${tenantId()}`,
    },
  });
}

function normalizeClaims(claims: unknown): Array<{ typ: string; val: string }> {
  if (!claims || typeof claims !== 'object') return [];
  return Object.entries(claims as Record<string, unknown>).flatMap(([typ, value]) => {
    if (Array.isArray(value)) return value.map((item) => ({ typ, val: String(item) }));
    if (value === undefined || value === null || typeof value === 'object') return [];
    return [{ typ, val: String(value) }];
  });
}

function claimValue(claims: Array<{ typ: string; val: string }>, ...types: string[]): string | undefined {
  return claims.find((claim) => types.includes(claim.typ))?.val;
}

function htmlMessage(title: string, message: string, status = 400): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101216;color:#f3f5f7;font-family:Segoe UI,system-ui,sans-serif}.card{width:min(460px,calc(100% - 32px));border:1px solid #303642;background:#181b22;border-radius:8px;padding:24px;text-align:center}a{display:inline-block;margin-top:14px;background:#36c2b4;color:#061412;text-decoration:none;border-radius:8px;padding:10px 13px;font-weight:650}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p><a href="/auth/login?returnTo=/mission-control">Try again</a></main></body></html>`;
}

function sendAuthError(res: Response, title: string, message: string, status = 400): void {
  res.status(status).type('html').send(htmlMessage(title, message, status));
}

export function registerMicrosoftWebAuthRoutes(server: Express): void {
  server.get('/auth/login', async (req: Request, res: Response) => {
    try {
      const returnTo = safeLocalRedirectPath(firstQueryValue(req.query.returnTo) || firstQueryValue(req.query.post_login_redirect_uri));
      const state = crypto.randomBytes(24).toString('base64url');
      setWebAuthStateCookie(res, { state, returnTo });
      const authUrl = await msalClient().getAuthCodeUrl({
        scopes: DEFAULT_SCOPES,
        redirectUri: redirectUri(req),
        state,
        responseMode: 'query',
      });
      res.redirect(302, authUrl);
    } catch (error: unknown) {
      console.error('[web-auth] login start failed:', error);
      sendAuthError(res, 'Sign-in configuration error', 'Morgan could not start Microsoft sign-in. Check the web auth app settings.', 500);
    }
  });

  server.get('/auth/callback', async (req: Request, res: Response) => {
    const error = firstQueryValue(req.query.error);
    if (error) {
      sendAuthError(res, 'Microsoft sign-in failed', firstQueryValue(req.query.error_description) || error, 401);
      return;
    }
    const code = firstQueryValue(req.query.code);
    const state = firstQueryValue(req.query.state);
    const expectedState = getWebAuthStateFromRequest(req);
    clearWebAuthStateCookie(res);
    if (!code || !state || !expectedState || state !== expectedState.state) {
      sendAuthError(res, 'Sign-in expired', 'The Microsoft sign-in response could not be matched to this browser session.', 401);
      return;
    }
    try {
      const result = await msalClient().acquireTokenByCode({
        code,
        scopes: DEFAULT_SCOPES,
        redirectUri: redirectUri(req),
      });
      const claims = normalizeClaims(result?.idTokenClaims);
      const principal: WebAuthPrincipal = {
        oid: claimValue(claims, 'oid') || result?.account?.localAccountId,
        email: claimValue(claims, 'preferred_username', 'email', 'upn') || result?.account?.username,
        name: claimValue(claims, 'name') || result?.account?.name,
        tenantId: claimValue(claims, 'tid') || result?.tenantId,
        claims,
        provider: 'morgan-web-auth',
      };
      if (!principal.oid) {
        sendAuthError(res, 'Sign-in incomplete', 'Microsoft sign-in completed, but no user identifier was returned.', 401);
        return;
      }
      setWebSessionCookie(res, principal);
      res.redirect(302, expectedState.returnTo);
    } catch (error: unknown) {
      console.error('[web-auth] token exchange failed:', error);
      sendAuthError(res, 'Microsoft sign-in failed', 'Morgan could not complete the Microsoft sign-in token exchange.', 401);
    }
  });

  server.get('/auth/me', (req: Request, res: Response) => {
    const principal = getWebSessionFromRequest(req);
    if (!principal?.oid) {
      res.status(401).json({ error: 'Unauthorized', loginUrl: `/auth/login?returnTo=${encodeURIComponent('/mission-control')}` });
      return;
    }
    res.status(200).json({ ok: true, principal });
  });

  server.get('/auth/logout', (req: Request, res: Response) => {
    clearWebAuthStateCookie(res);
    clearWebSessionCookie(res);
    res.redirect(302, safeLocalRedirectPath(firstQueryValue(req.query.returnTo) || firstQueryValue(req.query.post_logout_redirect_uri)));
  });

  server.get('/.auth/login/aad', (req: Request, res: Response) => {
    const returnTo = safeLocalRedirectPath(firstQueryValue(req.query.post_login_redirect_uri) || firstQueryValue(req.query.returnTo));
    res.redirect(302, `/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  });

  server.get('/.auth/logout', (req: Request, res: Response) => {
    const returnTo = safeLocalRedirectPath(firstQueryValue(req.query.post_logout_redirect_uri) || firstQueryValue(req.query.returnTo));
    res.redirect(302, `/auth/logout?returnTo=${encodeURIComponent(returnTo)}`);
  });
}