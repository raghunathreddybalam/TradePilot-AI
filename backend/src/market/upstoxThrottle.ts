/** Serialize Upstox HTTP calls + retry Cloudflare / API rate limits. */

const MIN_GAP_MS = 400;
const MAX_RETRIES = 4;

let chain: Promise<void> = Promise.resolve();
let lastAt = 0;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  return body.includes("rate_limited") || body.includes("Error 1015");
}

/**
 * Queue all Upstox fetches so we don't burst Cloudflare.
 * Retries with backoff when rate-limited.
 */
export async function upstoxFetch(url: string, init?: RequestInit): Promise<Response> {
  const run = async (): Promise<Response> => {
    let wait = 30_000;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const gap = MIN_GAP_MS - (Date.now() - lastAt);
      if (gap > 0) await sleep(gap);
      lastAt = Date.now();

      const res = await fetch(url, init);
      if (res.ok) return res;

      const text = await res.text();
      if (isRateLimited(res.status, text) && attempt < MAX_RETRIES) {
        console.warn(
          `[upstox] rate limited (${res.status}), retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`,
        );
        await sleep(wait);
        wait = Math.min(wait * 2, 120_000);
        continue;
      }

      // Reconstruct Response with body we already consumed
      return new Response(text, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    throw new Error("Upstox rate limit retries exhausted");
  };

  const next = chain.then(run, run);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export type CandleRow = [string, number, number, number, number, number, number?];

/** Process-wide candle cache (key = instrument|from|to|interval or instrument|intraday|n) */
const candleMemo = new Map<string, CandleRow[]>();

export function getCachedCandles(key: string): CandleRow[] | undefined {
  return candleMemo.get(key);
}

export function setCachedCandles(key: string, rows: CandleRow[]): void {
  candleMemo.set(key, rows);
}

export function candleCacheKey(
  instrumentKey: string,
  kind: "intraday" | "history",
  a: string,
  b?: string,
): string {
  return kind === "intraday"
    ? `${instrumentKey}|intraday|${a}`
    : `${instrumentKey}|hist|${a}|${b}`;
}
