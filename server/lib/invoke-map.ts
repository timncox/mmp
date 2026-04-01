/**
 * In-memory map for pending mmp-invoke calls.
 * When mmp-invoke sends a tool_call, it registers a callback here.
 * When mmp-send stores a tool_result with a matching call_id, it resolves the callback.
 */

export interface PendingInvoke {
  resolve: (result: { output?: unknown; error?: string | null; authorization?: unknown }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingInvoke>();

export function registerPending(
  callId: string,
  timeoutMs: number,
  resolve: PendingInvoke["resolve"],
): void {
  const timer = setTimeout(() => {
    pending.delete(callId);
    resolve({ error: `__timeout__` });
  }, timeoutMs);

  pending.set(callId, { resolve, timer });
}

export function resolvePending(callId: string, result: { output?: unknown; error?: string | null; authorization?: unknown }): boolean {
  const entry = pending.get(callId);
  if (!entry) return false;

  clearTimeout(entry.timer);
  pending.delete(callId);
  entry.resolve(result);
  return true;
}

export function hasPending(callId: string): boolean {
  return pending.has(callId);
}
