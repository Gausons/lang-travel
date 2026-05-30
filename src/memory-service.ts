import type { AgentPlanResult, AgentPlanningInput } from './multi-agent.js';
import { FileMemoryStore } from './memory-store.js';
import type { MemoryPatch, TenantContext, UserMemory } from './memory-types.js';

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function appendUnique(current: string[], values: unknown): string[] {
  const next = new Map<string, string>();
  for (const item of current) {
    const cleaned = item.trim();
    if (cleaned) {
      next.set(cleaned.toLowerCase(), cleaned);
    }
  }
  for (const item of cleanList(values)) {
    next.set(item.toLowerCase(), item);
  }
  return [...next.values()];
}

function hasPatchContent(patch: MemoryPatch): boolean {
  return Boolean(
    patch.profile?.homeCity ||
      patch.profile?.language ||
      cleanList(patch.profile?.travelStyleAdd).length > 0 ||
      cleanList(patch.interestsAdd).length > 0 ||
      cleanList(patch.habitsAdd).length > 0 ||
      cleanList(patch.dislikesAdd).length > 0 ||
      cleanList(patch.constraintsAdd).length > 0 ||
      patch.budget?.dailyCny !== undefined ||
      patch.budget?.totalCny !== undefined ||
      patch.budget?.hotelPerNightCny !== undefined ||
      patch.pace ||
      patch.prefer,
  );
}

export class MemoryService {
  constructor(private readonly store: FileMemoryStore = new FileMemoryStore()) {}

  recall(ctx: TenantContext): UserMemory {
    return this.store.getMemory(ctx);
  }

  listEvents(ctx: TenantContext) {
    return this.store.listEvents(ctx);
  }

  applyPatch(
    ctx: TenantContext,
    patch: MemoryPatch,
    source: 'preference_patch' | 'manual_patch' = 'manual_patch',
    sourcePayload: unknown = {},
  ): UserMemory {
    const current = this.store.getMemory(ctx);
    const next: UserMemory = {
      ...current,
      profile: {
        ...current.profile,
        homeCity: patch.profile?.homeCity?.trim() || current.profile.homeCity,
        language: patch.profile?.language?.trim() || current.profile.language,
        travelStyle: appendUnique(current.profile.travelStyle, patch.profile?.travelStyleAdd),
      },
      preferences: {
        ...current.preferences,
        interests: appendUnique(current.preferences.interests, patch.interestsAdd),
        habits: appendUnique(current.preferences.habits, patch.habitsAdd),
        dislikes: appendUnique(current.preferences.dislikes, patch.dislikesAdd),
        constraints: appendUnique(current.preferences.constraints, patch.constraintsAdd),
        budget: {
          ...current.preferences.budget,
          ...patch.budget,
        },
        pace: patch.pace ?? current.preferences.pace,
        prefer: patch.prefer ?? current.preferences.prefer,
      },
    };
    const saved = this.store.saveMemory(ctx, next);
    if (hasPatchContent(patch)) {
      this.store.appendEvent(ctx, {
        type: source,
        payload: { patch, source: sourcePayload },
      });
    }
    return saved;
  }

  recordAgentPlan(ctx: TenantContext, input: AgentPlanningInput, result: AgentPlanResult): void {
    this.store.appendEvent(ctx, {
      type: 'agent_plan',
      payload: {
        input: {
          city: input.city,
          days: input.days,
          dailyHours: input.dailyHours,
          interests: input.interests,
          habits: input.habits,
          totalBudgetCny: input.totalBudgetCny,
          hotelBudgetPerNight: input.hotelBudgetPerNight,
          prefer: input.prefer,
        },
        result: {
          summary: result.summary,
          stopCount: result.route.stops.length,
          hotelCount: result.hotels.length,
          routeSource: result.route.source,
        },
      },
    });
  }
}
