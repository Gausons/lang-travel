import type { Prefer } from './types.js';

export type TenantContext = {
  tenantId: string;
  userId: string;
  sessionId?: string;
};

export type TravelPace = 'relaxed' | 'normal' | 'packed';

export type MemoryBudget = {
  dailyCny?: number;
  totalCny?: number;
  hotelPerNightCny?: number;
};

export type UserMemory = {
  tenantId: string;
  userId: string;
  profile: {
    homeCity?: string;
    language?: string;
    travelStyle: string[];
  };
  preferences: {
    interests: string[];
    habits: string[];
    dislikes: string[];
    constraints: string[];
    budget: MemoryBudget;
    pace: TravelPace;
    prefer: Prefer;
  };
  feedback: Array<{
    targetType: 'place' | 'route' | 'hotel';
    targetId?: string;
    text: string;
    sentiment: 'like' | 'dislike' | 'neutral';
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type MemoryPatch = {
  profile?: {
    homeCity?: string;
    language?: string;
    travelStyleAdd?: string[];
  };
  interestsAdd?: string[];
  habitsAdd?: string[];
  dislikesAdd?: string[];
  constraintsAdd?: string[];
  budget?: MemoryBudget;
  pace?: TravelPace;
  prefer?: Prefer;
};

export type MemoryEvent = {
  id: string;
  tenantId: string;
  userId: string;
  sessionId?: string;
  type: 'preference_patch' | 'agent_plan' | 'manual_patch';
  payload: unknown;
  createdAt: string;
};
