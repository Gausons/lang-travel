import type { Prefer } from './types.js';
import { log } from './logger.js';
import type { MemoryBudget, MemoryPatch, TravelPace, UserMemory } from './memory-types.js';

export type PreferenceChatMessage = {
  role: 'assistant' | 'user';
  text: string;
};

export type PreferenceChatInput = {
  message: string;
  interests: string[];
  habits: string[];
  prefer: Prefer;
  memory?: UserMemory;
  history?: PreferenceChatMessage[];
};

export type PreferenceChatResult = {
  reply: string;
  interests: string[];
  habits: string[];
  dislikes: string[];
  constraints: string[];
  budget: MemoryBudget;
  pace: TravelPace;
  prefer: Prefer;
  aiApplied: boolean;
  memoryPatch: MemoryPatch;
};

type PreferencePatch = MemoryPatch;

export class PreferenceChatAiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'PreferenceChatAiError';
    this.statusCode = statusCode;
  }
}

function splitClean(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => String(value).trim()).filter(Boolean);
}

function appendValues(current: string[], values: string[]): string[] {
  const next = new Set(current.map((item) => item.trim()).filter(Boolean));
  for (const value of values) {
    const item = value.trim();
    if (item) {
      next.add(item);
    }
  }
  return [...next];
}

function mergeResult(input: PreferenceChatInput, patch: PreferencePatch, reply: string, aiApplied: boolean): PreferenceChatResult {
  const interests = appendValues(input.interests, patch.interestsAdd ?? []);
  const habits = appendValues(input.habits, patch.habitsAdd ?? []);
  const memoryPrefs = input.memory?.preferences;
  return {
    reply,
    interests,
    habits,
    dislikes: appendValues(memoryPrefs?.dislikes ?? [], patch.dislikesAdd ?? []),
    constraints: appendValues(memoryPrefs?.constraints ?? [], patch.constraintsAdd ?? []),
    budget: {
      ...(memoryPrefs?.budget ?? {}),
      ...(patch.budget ?? {}),
    },
    pace: patch.pace ?? memoryPrefs?.pace ?? 'normal',
    prefer: patch.prefer ?? input.prefer,
    aiApplied,
    memoryPatch: patch,
  };
}

function resolveChatCompletionsUrl(baseUrlRaw: string | undefined): string {
  const base = (baseUrlRaw || '').trim().replace(/\/+$/, '');
  if (!base) {
    return 'https://api.openai.com/v1/chat/completions';
  }
  if (base.endsWith('/chat/completions')) {
    return base;
  }
  if (base.endsWith('/models')) {
    return `${base.slice(0, -'/models'.length)}/chat/completions`;
  }
  if (/\/v\d+$/.test(base)) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

function isFilledAiKey(value: string | undefined): value is string {
  const key = value?.trim();
  return Boolean(key);
}

function parseAiPatch(content: string): null | { patch: PreferencePatch; reply: string } {
  const num = (value: unknown): number | undefined => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  const tryParse = (raw: string): null | { patch: PreferencePatch; reply: string } => {
    const parsed = JSON.parse(raw) as {
      reply?: unknown;
      interests_add?: unknown;
      habits_add?: unknown;
      dislikes_add?: unknown;
      constraints_add?: unknown;
      travel_style_add?: unknown;
      home_city?: unknown;
      language?: unknown;
      pace?: unknown;
      prefer?: unknown;
      budget_daily_cny?: unknown;
      budget_total_cny?: unknown;
      hotel_budget_per_night_cny?: unknown;
    };
    const prefer =
      parsed.prefer === 'park' || parsed.prefer === 'attraction' || parsed.prefer === 'mixed'
        ? parsed.prefer
        : undefined;
    const pace =
      parsed.pace === 'relaxed' || parsed.pace === 'normal' || parsed.pace === 'packed'
        ? parsed.pace
        : undefined;
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    const budget = {
      dailyCny: num(parsed.budget_daily_cny),
      totalCny: num(parsed.budget_total_cny),
      hotelPerNightCny: num(parsed.hotel_budget_per_night_cny),
    };
    return {
      reply,
      patch: {
        profile: {
          homeCity: typeof parsed.home_city === 'string' ? parsed.home_city.trim() : undefined,
          language: typeof parsed.language === 'string' ? parsed.language.trim() : undefined,
          travelStyleAdd: splitClean(parsed.travel_style_add),
        },
        interestsAdd: splitClean(parsed.interests_add),
        habitsAdd: splitClean(parsed.habits_add),
        dislikesAdd: splitClean(parsed.dislikes_add),
        constraintsAdd: splitClean(parsed.constraints_add),
        budget,
        pace,
        prefer,
      },
    };
  };

  try {
    return tryParse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      return tryParse(content.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

async function callAi(input: PreferenceChatInput): Promise<{ patch: PreferencePatch; reply: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!isFilledAiKey(apiKey)) {
    throw new PreferenceChatAiError('偏好聊天需要真实 AI，但 OPENAI_API_KEY 未配置', 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const model = process.env.OPENAI_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-5.4-mini';
    const response = await fetch(resolveChatCompletionsUrl(process.env.OPENAI_BASE_URL), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是旅行偏好访谈助手。根据用户多轮对话提取旅行兴趣、习惯、限制和路线倾向。回复要像自然对话，避免固定模板和机械复读；即使用户只是闲聊或打招呼，也要自然回应，再轻轻把话题带回旅行偏好；问候、寒暄、无明确旅行偏好的短句不要写入偏好标签。只输出严格 JSON，不要 markdown。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              schema: {
                reply: '给用户的中文回复，简短自然，不要每轮都用同一句开头，并继续追问一个最有价值的问题',
                interests_add: ['新增兴趣标签，短词，不要重复现有标签'],
                habits_add: ['新增习惯/限制，短词，不要重复现有限制'],
                dislikes_add: ['用户明确不喜欢或想避开的内容，短词'],
                constraints_add: ['硬约束，如带娃、老人同行、轮椅、过敏、必须地铁等'],
                travel_style_add: ['稳定旅行风格，如松弛、小众、文化向、亲子'],
                budget_daily_cny: '数字或 null',
                budget_total_cny: '数字或 null',
                hotel_budget_per_night_cny: '数字或 null',
                home_city: '常住城市或 null',
                language: '偏好语言或 null',
                pace: 'relaxed | normal | packed | null',
                prefer: 'mixed | park | attraction | null',
              },
              current: {
                interests: input.interests,
                habits: input.habits,
                prefer: input.prefer,
                longTermMemory: input.memory ?? null,
              },
              recentHistory: (input.history ?? []).slice(-8),
              latestUserMessage: input.message,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      let errorCode = '';
      let errorMessage = '';
      try {
        const parsed = JSON.parse(raw) as { error?: { code?: unknown; message?: unknown } };
        errorCode = typeof parsed.error?.code === 'string' ? parsed.error.code : '';
        errorMessage = typeof parsed.error?.message === 'string' ? parsed.error.message : '';
      } catch {
        errorMessage = raw.slice(0, 160);
      }
      log('warn', 'preference.chat.ai_failed', {
        status: response.status,
        statusText: response.statusText,
        errorCode,
        errorMessage,
      });
      const authHint =
        response.status === 401 || errorCode === 'token_expired'
          ? '本地 AI 代理认证已过期，请重新登录或刷新代理服务'
          : '请检查 OPENAI_BASE_URL / OPENAI_MODEL 或上游 AI 服务状态';
      throw new PreferenceChatAiError(
        `偏好聊天 AI 请求失败: ${response.status} ${errorCode || response.statusText}${errorMessage ? ` - ${errorMessage}` : ''}。${authHint}`,
        response.status === 401 ? 401 : 502,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      log('warn', 'preference.chat.ai_failed', { reason: 'missing_content' });
      throw new PreferenceChatAiError('偏好聊天 AI 返回为空', 502);
    }
    const parsed = parseAiPatch(content);
    if (!parsed) {
      log('warn', 'preference.chat.ai_failed', { reason: 'invalid_json' });
      throw new PreferenceChatAiError('偏好聊天 AI 返回格式不是有效 JSON', 502);
    }
    if (!parsed.reply) {
      log('warn', 'preference.chat.ai_failed', { reason: 'missing_reply' });
      throw new PreferenceChatAiError('偏好聊天 AI 没有返回 reply', 502);
    }
    return parsed;
  } catch (err) {
    if (err instanceof PreferenceChatAiError) {
      throw err;
    }
    log('warn', 'preference.chat.ai_failed', {
      reason: err instanceof Error ? err.message || err.name : 'unknown_error',
    });
    throw new PreferenceChatAiError(
      `偏好聊天 AI 调用异常: ${err instanceof Error ? err.message || err.name : 'unknown_error'}`,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolvePreferenceChat(input: PreferenceChatInput): Promise<PreferenceChatResult> {
  const ai = await callAi(input);
  return mergeResult(input, ai.patch, ai.reply, true);
}
