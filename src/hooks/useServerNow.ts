import { useEffect, useState } from "react";

interface HasClock {
  serverNow: () => number;
}

/**
 * Server-corrected "now" (epoch ms) that re-renders the caller every `intervalMs` — or never, while `enabled` is
 * false (a countdown with no deadline has nothing to tick: seven idle seats must not re-render five times a second).
 */
export function useServerNow(room: HasClock, intervalMs = 100, enabled = true): number {
  const { serverNow } = room;
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (!enabled) return;
    setNow(serverNow());
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [serverNow, intervalMs, enabled]);
  return now;
}

/** Time left until a server deadline. `remainingMs`/`seconds` are null when there is no deadline. */
export function useCountdown(
  deadline: number | null | undefined,
  room: HasClock,
  intervalMs = 100,
): { remainingMs: number | null; seconds: number | null } {
  const now = useServerNow(room, intervalMs, deadline != null);
  if (deadline == null) return { remainingMs: null, seconds: null };
  const remainingMs = Math.max(0, deadline - now);
  return { remainingMs, seconds: Math.ceil(remainingMs / 1000) };
}
