type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_GET = 120;
const MAX_POST = 30;

function prune(key: string, now: number): Bucket {
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    const fresh = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, fresh);
    return fresh;
  }
  return b;
}

export function rateLimitPublicOfferGet(ip: string): boolean {
  const now = Date.now();
  const key = `g:${ip}`;
  const b = prune(key, now);
  b.count += 1;
  buckets.set(key, b);
  return b.count <= MAX_GET;
}

export function rateLimitPublicOfferMutation(ip: string, tokenPrefix: string): boolean {
  const now = Date.now();
  const key = `m:${ip}:${tokenPrefix.slice(0, 12)}`;
  const b = prune(key, now);
  b.count += 1;
  buckets.set(key, b);
  return b.count <= MAX_POST;
}
