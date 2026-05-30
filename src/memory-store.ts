import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MemoryEvent, TenantContext, TravelPace, UserMemory } from './memory-types.js';
import type { Prefer } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
export const MEMORY_ROOT_DIR = path.join(ROOT_DIR, 'data', 'tenants');
export const DEFAULT_MEMORY_MAX_LINES = 300;
export const HARD_MEMORY_MAX_LINES = 300;

function nowIso(): string {
  return new Date().toISOString();
}

export function resolveMemoryMaxLines(value: string | undefined = process.env.MEMORY_MAX_LINES): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MEMORY_MAX_LINES;
  }
  return Math.max(40, Math.min(HARD_MEMORY_MAX_LINES, Math.floor(parsed)));
}

function createDefaultMemory(ctx: TenantContext): UserMemory {
  const now = nowIso();
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    profile: {
      travelStyle: [],
    },
    preferences: {
      interests: [],
      habits: [],
      dislikes: [],
      constraints: [],
      budget: {},
      pace: 'normal',
      prefer: 'mixed',
    },
    feedback: [],
    createdAt: now,
    updatedAt: now,
  };
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function ensurePrefer(value: unknown): Prefer {
  return value === 'park' || value === 'attraction' || value === 'mixed' ? value : 'mixed';
}

function ensurePace(value: unknown): TravelPace {
  return value === 'relaxed' || value === 'packed' || value === 'normal' ? value : 'normal';
}

function ensureMemory(ctx: TenantContext, raw: unknown): UserMemory {
  if (!raw || typeof raw !== 'object') {
    return createDefaultMemory(ctx);
  }
  const source = raw as Partial<UserMemory>;
  const defaults = createDefaultMemory(ctx);
  const preferences = source.preferences ?? defaults.preferences;
  const profile = source.profile ?? defaults.profile;
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    profile: {
      homeCity: typeof profile.homeCity === 'string' ? profile.homeCity : undefined,
      language: typeof profile.language === 'string' ? profile.language : undefined,
      travelStyle: ensureStringArray(profile.travelStyle),
    },
    preferences: {
      interests: ensureStringArray(preferences.interests),
      habits: ensureStringArray(preferences.habits),
      dislikes: ensureStringArray(preferences.dislikes),
      constraints: ensureStringArray(preferences.constraints),
      budget:
        preferences.budget && typeof preferences.budget === 'object'
          ? {
              dailyCny:
                typeof preferences.budget.dailyCny === 'number' ? preferences.budget.dailyCny : undefined,
              totalCny:
                typeof preferences.budget.totalCny === 'number' ? preferences.budget.totalCny : undefined,
              hotelPerNightCny:
                typeof preferences.budget.hotelPerNightCny === 'number'
                  ? preferences.budget.hotelPerNightCny
                  : undefined,
            }
          : {},
      pace: ensurePace(preferences.pace),
      prefer: ensurePrefer(preferences.prefer),
    },
    feedback: Array.isArray(source.feedback) ? source.feedback : [],
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : defaults.createdAt,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : defaults.updatedAt,
  };
}

function inline(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '/')
    .trim();
}

function optional(value: unknown): string {
  const text = inline(value);
  return text || '-';
}

function numOrDash(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-';
}

function parseOptional(value: string): string | undefined {
  const cleaned = value.trim();
  return cleaned && cleaned !== '-' ? cleaned : undefined;
}

function parseNum(value: string): number | undefined {
  const cleaned = value.trim();
  if (!cleaned || cleaned === '-') {
    return undefined;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function listLimit(maxLines: number): number {
  return Math.max(4, Math.floor((maxLines - 62) / 5));
}

function takeRecent(values: string[], limit: number): string[] {
  return values.slice(Math.max(0, values.length - limit));
}

function addList(lines: string[], title: string, values: string[], limit: number): void {
  lines.push(`### ${title}`);
  const items = takeRecent(values, limit);
  if (items.length === 0) {
    lines.push('- -');
    return;
  }
  for (const item of items) {
    lines.push(`- ${inline(item)}`);
  }
}

function renderMemoryMarkdown(memory: UserMemory, maxLines: number): string {
  const limit = listLimit(maxLines);
  const lines: string[] = [
    '# Lang Travel Memory',
    '',
    `- Tenant ID: ${inline(memory.tenantId)}`,
    `- User ID: ${inline(memory.userId)}`,
    `- Created At: ${inline(memory.createdAt)}`,
    `- Updated At: ${inline(memory.updatedAt)}`,
    '',
    '## Profile',
    `- Home City: ${optional(memory.profile.homeCity)}`,
    `- Language: ${optional(memory.profile.language)}`,
  ];

  addList(lines, 'Travel Style', memory.profile.travelStyle, Math.max(4, Math.floor(limit / 2)));
  lines.push(
    '',
    '## Preferences',
    `- Prefer: ${memory.preferences.prefer}`,
    `- Pace: ${memory.preferences.pace}`,
    '',
  );
  addList(lines, 'Interests', memory.preferences.interests, limit);
  addList(lines, 'Habits', memory.preferences.habits, limit);
  addList(lines, 'Dislikes', memory.preferences.dislikes, limit);
  addList(lines, 'Constraints', memory.preferences.constraints, limit);
  lines.push(
    '### Budget',
    `- Daily CNY: ${numOrDash(memory.preferences.budget.dailyCny)}`,
    `- Total CNY: ${numOrDash(memory.preferences.budget.totalCny)}`,
    `- Hotel Per Night CNY: ${numOrDash(memory.preferences.budget.hotelPerNightCny)}`,
    '',
    '## Feedback',
  );

  const feedbackLimit = Math.max(2, Math.floor(limit / 2));
  for (const item of memory.feedback.slice(-feedbackLimit)) {
    lines.push(
      `- ${inline(item.createdAt)} | ${item.sentiment} | ${item.targetType} | ${optional(item.targetId)} | ${inline(item.text)}`,
    );
  }
  if (memory.feedback.length === 0) {
    lines.push('- -');
  }

  return `${lines.slice(0, maxLines).join('\n')}\n`;
}

function parseMemoryMarkdown(ctx: TenantContext, raw: string): UserMemory {
  const defaults = createDefaultMemory(ctx);
  const memory = createDefaultMemory(ctx);
  let section = '';

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) {
      section = trimmed.slice(4).trim().toLowerCase();
      continue;
    }
    if (trimmed.startsWith('## ')) {
      section = trimmed.slice(3).trim().toLowerCase();
      continue;
    }
    if (!trimmed.startsWith('- ')) {
      continue;
    }
    const item = trimmed.slice(2).trim();
    const [keyRaw, ...valueParts] = item.split(':');
    const key = keyRaw.trim().toLowerCase();
    const value = valueParts.join(':').trim();

    if (section === '' || section === 'profile' || section === 'preferences') {
      if (key === 'tenant id') {
        continue;
      }
      if (key === 'user id') {
        continue;
      }
      if (key === 'created at') {
        memory.createdAt = parseOptional(value) ?? defaults.createdAt;
        continue;
      }
      if (key === 'updated at') {
        memory.updatedAt = parseOptional(value) ?? defaults.updatedAt;
        continue;
      }
      if (key === 'home city') {
        memory.profile.homeCity = parseOptional(value);
        continue;
      }
      if (key === 'language') {
        memory.profile.language = parseOptional(value);
        continue;
      }
      if (key === 'prefer') {
        memory.preferences.prefer = ensurePrefer(value);
        continue;
      }
      if (key === 'pace') {
        memory.preferences.pace = ensurePace(value);
        continue;
      }
    }

    if (section === 'travel style' && item !== '-') {
      memory.profile.travelStyle.push(item);
    } else if (section === 'interests' && item !== '-') {
      memory.preferences.interests.push(item);
    } else if (section === 'habits' && item !== '-') {
      memory.preferences.habits.push(item);
    } else if (section === 'dislikes' && item !== '-') {
      memory.preferences.dislikes.push(item);
    } else if (section === 'constraints' && item !== '-') {
      memory.preferences.constraints.push(item);
    } else if (section === 'budget') {
      if (key === 'daily cny') {
        memory.preferences.budget.dailyCny = parseNum(value);
      } else if (key === 'total cny') {
        memory.preferences.budget.totalCny = parseNum(value);
      } else if (key === 'hotel per night cny') {
        memory.preferences.budget.hotelPerNightCny = parseNum(value);
      }
    } else if (section === 'feedback' && item !== '-') {
      const [createdAt, sentiment, targetType, targetId, ...textParts] = item
        .split('|')
        .map((part) => part.trim());
      if (
        (sentiment === 'like' || sentiment === 'dislike' || sentiment === 'neutral') &&
        (targetType === 'place' || targetType === 'route' || targetType === 'hotel')
      ) {
        memory.feedback.push({
          createdAt: createdAt || nowIso(),
          sentiment,
          targetType,
          targetId: parseOptional(targetId ?? ''),
          text: textParts.join(' | ').trim(),
        });
      }
    }
  }

  return ensureMemory(ctx, memory);
}

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload ?? {}), 'utf-8').toString('base64url');
}

function decodePayload(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value.trim(), 'base64url').toString('utf-8')) as unknown;
  } catch {
    return {};
  }
}

function renderEventsMarkdown(ctx: TenantContext, events: MemoryEvent[], maxLines: number): string {
  const eventLimit = Math.max(1, Math.floor((maxLines - 6) / 2));
  const lines = [
    '# Lang Travel Memory Events',
    '',
    `- Tenant ID: ${inline(ctx.tenantId)}`,
    `- User ID: ${inline(ctx.userId)}`,
    '',
    '## Events',
  ];

  for (const event of events.slice(-eventLimit)) {
    lines.push(
      `- ${inline(event.createdAt)} | ${event.type} | id=${inline(event.id)} | session=${optional(event.sessionId)}`,
    );
    lines.push(`  - Payload: ${encodePayload(event.payload)}`);
  }
  return `${lines.slice(0, maxLines).join('\n')}\n`;
}

function parseEventsMarkdown(ctx: TenantContext, raw: string): MemoryEvent[] {
  const events: MemoryEvent[] = [];
  let current: MemoryEvent | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const eventMatch = line.match(/^- ([^|]+) \| ([^|]+) \| id=([^|]+) \| session=(.+)$/);
    if (eventMatch) {
      current = {
        createdAt: eventMatch[1].trim(),
        type: eventMatch[2].trim() as MemoryEvent['type'],
        id: eventMatch[3].trim(),
        sessionId: parseOptional(eventMatch[4].trim()),
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        payload: {},
      };
      events.push(current);
      continue;
    }
    const payloadMatch = line.match(/^  - Payload: (.+)$/);
    if (payloadMatch && current) {
      current.payload = decodePayload(payloadMatch[1]);
    }
  }

  return events.filter((event) =>
    event.type === 'preference_patch' || event.type === 'agent_plan' || event.type === 'manual_patch',
  );
}

export class FileMemoryStore {
  constructor(
    private readonly rootDir: string = MEMORY_ROOT_DIR,
    private readonly maxLines: number = resolveMemoryMaxLines(),
  ) {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  getMemory(ctx: TenantContext): UserMemory {
    const filePath = this.memoryPath(ctx);
    if (fs.existsSync(filePath)) {
      return parseMemoryMarkdown(ctx, fs.readFileSync(filePath, 'utf-8'));
    }

    const legacyPath = this.legacyMemoryPath(ctx);
    if (fs.existsSync(legacyPath)) {
      const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as unknown;
      const migrated = ensureMemory(ctx, raw);
      this.writeMemory(ctx, migrated);
      return migrated;
    }

    return createDefaultMemory(ctx);
  }

  saveMemory(ctx: TenantContext, memory: UserMemory): UserMemory {
    const next = {
      ...memory,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      updatedAt: nowIso(),
    };
    this.writeMemory(ctx, next);
    return next;
  }

  appendEvent(ctx: TenantContext, event: Omit<MemoryEvent, 'id' | 'createdAt' | 'tenantId' | 'userId'>): MemoryEvent {
    const events = this.listEvents(ctx);
    const next: MemoryEvent = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      ...event,
      createdAt: nowIso(),
    };
    events.push(next);
    this.writeEvents(ctx, events);
    return next;
  }

  listEvents(ctx: TenantContext): MemoryEvent[] {
    const filePath = this.eventsPath(ctx);
    if (fs.existsSync(filePath)) {
      return parseEventsMarkdown(ctx, fs.readFileSync(filePath, 'utf-8'));
    }

    const legacyPath = this.legacyEventsPath(ctx);
    if (fs.existsSync(legacyPath)) {
      const parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as unknown;
      const events = Array.isArray(parsed) ? (parsed as MemoryEvent[]) : [];
      this.writeEvents(ctx, events);
      return events;
    }

    return [];
  }

  private writeMemory(ctx: TenantContext, memory: UserMemory): void {
    const filePath = this.memoryPath(ctx);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, renderMemoryMarkdown(memory, this.maxLines), 'utf-8');
  }

  private writeEvents(ctx: TenantContext, events: MemoryEvent[]): void {
    const filePath = this.eventsPath(ctx);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, renderEventsMarkdown(ctx, events, this.maxLines), 'utf-8');
  }

  private userDir(ctx: TenantContext): string {
    return path.join(this.rootDir, ctx.tenantId, 'users', ctx.userId);
  }

  private memoryPath(ctx: TenantContext): string {
    return path.join(this.userDir(ctx), 'memory.md');
  }

  private eventsPath(ctx: TenantContext): string {
    return path.join(this.userDir(ctx), 'memory-events.md');
  }

  private legacyMemoryPath(ctx: TenantContext): string {
    return path.join(this.userDir(ctx), 'memory.json');
  }

  private legacyEventsPath(ctx: TenantContext): string {
    return path.join(this.userDir(ctx), 'memory-events.json');
  }
}
