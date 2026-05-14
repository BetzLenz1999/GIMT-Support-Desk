export type FetchWithRetryOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryResponse(response: Response): boolean {
  return response.status === 429 || response.status >= 500;
}

function getRetryDelay(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * 2 ** attempt;
}

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal
      });

      if (!shouldRetryResponse(response) || attempt === retries) {
        return response;
      }

      await response.text().catch(() => undefined);
      await sleep(getRetryDelay(attempt, retryDelayMs));
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(getRetryDelay(attempt, retryDelayMs));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
