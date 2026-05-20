import type { Prefer } from './types.js';
import { log } from './logger.js';

export type PreferenceChatMessage = {
  role: 'assistant' | 'user';
  text: string;
};

export type PreferenceChatInput = {
  message: string;
  interests: string[];
  habits: string[];
  prefer: Prefer;
  history?: PreferenceChatMessage[];
};

export type PreferenceChatResult = {
  reply: string;
  interests: string[];
  habits: string[];
  prefer: Prefer;
  aiApplied: boolean;
};

type PreferencePatch = {
  interests: string[];
  habits: string[];
  prefer?: Prefer;
};

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

function inferPreferencePatch(message: string): PreferencePatch {
  const interests: string[] = [];
  const habits: string[] = [];
  const addIfMatch = (pattern: RegExp, value: string, target: string[]): void => {
    if (pattern.test(message) && !target.includes(value)) {
      target.push(value);
    }
  };

  addIfMatch(/公园|绿地|自然|湖|散步|走走/, '公园', interests);
  addIfMatch(/美食|餐厅|小吃|吃|咖啡|甜品/, '美食', interests);
  addIfMatch(/博物馆|展览|美术馆|艺术|历史/, '博物馆展览', interests);
  addIfMatch(/地标|建筑|城市|打卡|景点/, '地标景点', interests);
  addIfMatch(/夜景|夜游|酒吧|live|演出/, '夜生活', interests);
  addIfMatch(/亲子|孩子|儿童|带娃/, '亲子', interests);
  addIfMatch(/购物|商场|买东西/, '购物', interests);
  addIfMatch(/摄影|拍照|出片/, '摄影', interests);
  addIfMatch(/小众|人少|安静|避开人多/, '小众安静', interests);

  if (/不早起|不想早起|晚起|睡懒觉|下午开始/.test(message)) {
    habits.push('不早起');
  } else {
    addIfMatch(/早起|上午|清晨/, '早起', habits);
  }
  addIfMatch(/少走|不想走|走不动|打车/, '少走路', habits);
  addIfMatch(/多走|徒步|步行|citywalk|city walk/i, '步行可接受', habits);
  addIfMatch(/地铁|公交|公共交通/, '地铁优先', habits);
  addIfMatch(/慢节奏|轻松|松弛|不要太赶/, '慢节奏', habits);
  addIfMatch(/紧凑|多玩|尽量多/, '紧凑行程', habits);
  addIfMatch(/预算|省钱|便宜|性价比/, '预算友好', habits);
  addIfMatch(/舒适|酒店好|住好一点/, '住宿舒适优先', habits);

  if (/只.*公园|公园.*为主|自然.*为主/.test(message)) {
    return { interests, habits, prefer: 'park' };
  }
  if (/景点.*为主|地标.*为主|博物馆.*为主/.test(message)) {
    return { interests, habits, prefer: 'attraction' };
  }
  return { interests, habits };
}

function hasAny(values: string[], patterns: RegExp[]): boolean {
  return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

function nextPreferenceQuestion(interests: string[], habits: string[]): string {
  if (!hasAny(habits, [/早起|不早起|晚起|下午/])) {
    return '你更偏早出门，还是想睡到自然醒、下午开始？';
  }
  if (!hasAny(habits, [/少走|步行|地铁|打车|公共交通/])) {
    return '交通上你能接受多走路吗，还是希望地铁/打车优先？';
  }
  if (!hasAny(habits, [/预算|省钱|性价比|舒适|住宿/])) {
    return '预算和住宿上，你更想省钱，还是住得舒服一点？';
  }
  if (!hasAny(interests, [/小众|夜生活|摄影|亲子|购物/])) {
    return '还有没有特别想加的风格，比如小众、人少、夜景、摄影、亲子或购物？';
  }
  return '还有什么雷点或硬性限制，也可以继续告诉我。准备好了就点“一键自主规划”。';
}

function buildRuleReply(patch: PreferencePatch, interests: string[], habits: string[]): string {
  const learned: string[] = [];
  if (patch.interests.length > 0) {
    learned.push(`兴趣：${patch.interests.join('、')}`);
  }
  if (patch.habits.length > 0) {
    learned.push(`习惯/限制：${patch.habits.join('、')}`);
  }
  if (patch.prefer) {
    learned.push(`路线倾向：${patch.prefer === 'park' ? '公园自然为主' : '景点地标为主'}`);
  }
  const prefix =
    learned.length > 0
      ? `收到，已更新${learned.join('；')}。`
      : '收到，我先把这句作为补充偏好记录下来。';
  return `${prefix}\n${nextPreferenceQuestion(interests, habits)}`;
}

function mergeResult(input: PreferenceChatInput, patch: PreferencePatch, reply: string, aiApplied: boolean): PreferenceChatResult {
  const rawHabit = `用户补充：${input.message.trim()}`;
  const interests = appendValues(input.interests, patch.interests);
  const habits = appendValues(input.habits, [...patch.habits, rawHabit]);
  return {
    reply,
    interests,
    habits,
    prefer: patch.prefer ?? input.prefer,
    aiApplied,
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

function parseAiPatch(content: string): null | { patch: PreferencePatch; reply: string } {
  const tryParse = (raw: string): null | { patch: PreferencePatch; reply: string } => {
    const parsed = JSON.parse(raw) as {
      reply?: unknown;
      interests_add?: unknown;
      habits_add?: unknown;
      prefer?: unknown;
    };
    const prefer =
      parsed.prefer === 'park' || parsed.prefer === 'attraction' || parsed.prefer === 'mixed'
        ? parsed.prefer
        : undefined;
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    return {
      reply,
      patch: {
        interests: splitClean(parsed.interests_add),
        habits: splitClean(parsed.habits_add),
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

async function callAi(input: PreferenceChatInput): Promise<null | { patch: PreferencePatch; reply: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
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
              '你是旅行偏好访谈助手。根据用户多轮对话提取旅行兴趣、习惯、限制和路线倾向。只输出严格 JSON，不要 markdown。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              schema: {
                reply: '给用户的中文回复，简短自然，并继续追问一个最有价值的问题',
                interests_add: ['新增兴趣标签，短词，不要重复现有标签'],
                habits_add: ['新增习惯/限制，短词，不要重复现有限制'],
                prefer: 'mixed | park | attraction | null',
              },
              current: {
                interests: input.interests,
                habits: input.habits,
                prefer: input.prefer,
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
      return null;
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      log('warn', 'preference.chat.ai_failed', { reason: 'missing_content' });
      return null;
    }
    return parseAiPatch(content);
  } catch (err) {
    log('warn', 'preference.chat.ai_failed', {
      reason: err instanceof Error ? err.name : 'unknown_error',
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolvePreferenceChat(input: PreferenceChatInput): Promise<PreferenceChatResult> {
  const ai = await callAi(input);
  if (ai) {
    const mergedInterests = appendValues(input.interests, ai.patch.interests);
    const mergedHabits = appendValues(input.habits, ai.patch.habits);
    return mergeResult(
      input,
      ai.patch,
      ai.reply || buildRuleReply(ai.patch, mergedInterests, mergedHabits),
      true,
    );
  }

  const patch = inferPreferencePatch(input.message);
  const mergedInterests = appendValues(input.interests, patch.interests);
  const mergedHabits = appendValues(input.habits, patch.habits);
  return mergeResult(input, patch, buildRuleReply(patch, mergedInterests, mergedHabits), false);
}
