/**
 * Simple in-memory rate limiter.
 * Tracks request counts per key (IP or handle) in sliding windows.
 */

interface RateWindow {
  count: number;
  resetAt: number;
}

const windows = new Map<string, RateWindow>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, win] of windows) {
    if (now > win.resetAt) windows.delete(key);
  }
}, 5 * 60_000);

/**
 * Check if a request should be rate-limited.
 * Returns { allowed: true } or { allowed: false, retryAfterMs }.
 */
export function checkRate(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now > existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (existing.count >= maxRequests) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count++;
  return { allowed: true };
}
