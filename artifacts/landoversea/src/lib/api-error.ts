export type NormalizedApiError = {
  message: string;
  status?: number;
};

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  return trimmed === '' ? undefined : trimmed;
}

function stripHttpPrefix(message: string): string {
  return message.replace(/^HTTP \d{3}(?: [^:]+)?:\s*/i, '').trim();
}

export function normalizeApiError(
  error: unknown,
  fallback: string,
): NormalizedApiError {
  if (!error || typeof error !== 'object') {
    return { message: fallback };
  }

  const candidate = error as {
    status?: unknown;
    data?: unknown;
    message?: unknown;
  };
  const status =
    typeof candidate.status === 'number' ? candidate.status : undefined;
  const apiMessage =
    getStringField(candidate.data, 'error') ??
    getStringField(candidate.data, 'message') ??
    getStringField(candidate.data, 'detail');

  if (apiMessage) return { message: apiMessage, status };

  if (typeof candidate.message === 'string') {
    const message = stripHttpPrefix(candidate.message);
    if (message !== '') return { message, status };
  }

  return { message: fallback, status };
}