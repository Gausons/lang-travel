export function resolveChatCompletionsUrl(baseUrlRaw: string | undefined): string {
  const base = (baseUrlRaw || '').trim().replace(/\/+$/, '');
  if (!base) {
    return 'https://api.openai.com/v1/chat/completions';
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(base) ? base : `http://${base}`;
  if (withProtocol.endsWith('/chat/completions')) {
    return withProtocol;
  }
  if (withProtocol.endsWith('/models')) {
    return `${withProtocol.slice(0, -'/models'.length)}/chat/completions`;
  }
  if (/\/v\d+$/i.test(withProtocol)) {
    return `${withProtocol}/chat/completions`;
  }
  return `${withProtocol}/v1/chat/completions`;
}
