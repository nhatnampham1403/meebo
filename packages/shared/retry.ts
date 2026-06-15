const BACKOFF_MS = [1000, 2000, 3000];

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = 3,
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        const delay = BACKOFF_MS[i] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
