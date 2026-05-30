import type { IncomingMessage } from 'node:http';

import type { TenantContext } from './memory-types.js';

type MaybeRecord = Record<string, unknown>;

function firstHeader(req: IncomingMessage, name: string): string {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return String(value[0] ?? '').trim();
  }
  return String(value ?? '').trim();
}

function bodyValue(body: unknown, key: string): string {
  if (!body || typeof body !== 'object') {
    return '';
  }
  const value = (body as MaybeRecord)[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function cleanContextPart(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_.@-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

export function resolveTenantContext(
  req: IncomingMessage,
  searchParams?: URLSearchParams,
  body?: unknown,
): TenantContext {
  const tenantId =
    firstHeader(req, 'x-tenant-id') ||
    searchParams?.get('tenantId')?.trim() ||
    bodyValue(body, 'tenantId');
  const userId =
    firstHeader(req, 'x-user-id') ||
    searchParams?.get('userId')?.trim() ||
    bodyValue(body, 'userId');
  const sessionId =
    firstHeader(req, 'x-session-id') ||
    searchParams?.get('sessionId')?.trim() ||
    bodyValue(body, 'sessionId');

  return {
    tenantId: cleanContextPart(tenantId, 'default'),
    userId: cleanContextPart(userId, 'local-user'),
    sessionId: sessionId ? cleanContextPart(sessionId, 'default-session') : undefined,
  };
}
