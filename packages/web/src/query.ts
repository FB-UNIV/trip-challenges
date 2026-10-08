// One data cache for the whole app (TanStack Query): screens show what's cached at once and
// refresh behind it, refetch when the app comes back to the foreground or reconnects, poll
// gently while open, and an action refreshes everything it changed.
import { QueryClient, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api, HttpError } from "./api.js";

/**
 * How often an open, visible screen refreshes. A whole class can share one public IP on a
 * trip (school wifi, a hotspot), and the API allows 600 requests/min per IP: 30 phones × a
 * couple of queries every 20 s stays well under it. Hidden tabs don't poll.
 */
export const LIVE_MS = 20_000;

/** `retry`: tests pass false so a failing screen shows its error without waiting for retries. */
export function createQueryClient({ retry = true }: { retry?: boolean } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Long enough that screens mounting together (tab bar + page) share one request.
        staleTime: 2_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        // A 4xx is an answer (signed out, not found, wrong phase), not a hiccup: don't retry it.
        retry: (failures, e) => retry && !(e instanceof HttpError && e.status < 500) && failures < 2,
      },
      mutations: { retry: false },
    },
  });
}

export const qk = {
  student: ["student"] as const,
  me: ["student", "me"] as const,
  myChallenges: ["student", "challenges"] as const,
  teams: ["student", "teams"] as const,
  submissions: (challengeId: string) => ["student", "submissions", challengeId] as const,
  challengeBySlug: (slug: string) => ["challenge", slug] as const,
  // Teacher. Everything about one trip lives under ["trip", id], so one invalidation
  // after an action refreshes the nav badge, the overview, the lists — all of it.
  teacherMe: ["teacher", "me"] as const,
  trips: ["teacher", "trips"] as const,
  trip: (id: string) => ["trip", id] as const,
  tripPart: (id: string, ...part: string[]) => ["trip", id, ...part] as const,
};

/** useQuery in useAsync's shape ({ data, error, loading, reload }), so screens keep their render. */
export function useLoad<T>(
  queryKey: QueryKey, queryFn: () => Promise<T>, opts: { live?: boolean; enabled?: boolean } = {},
) {
  const q = useQuery({ queryKey, queryFn, refetchInterval: opts.live ? LIVE_MS : false, enabled: opts.enabled ?? true });
  return { data: q.data ?? null, error: q.error ?? null, loading: q.isLoading, reload: () => void q.refetch() };
}

/** Refresh every cached query under these keys (e.g. after an action changed them). */
export function useRefresh() {
  const qc = useQueryClient();
  return (...keys: QueryKey[]) => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))).then(() => {});
}

/** After a teacher action: refresh everything about this trip (and the trip list's phase/name). */
export function useTripRefresh(tripId: string) {
  const refresh = useRefresh();
  return () => refresh(qk.trip(tripId), qk.trips);
}

/**
 * Optimistic update: apply `change` to the cached data at `key` now, run `action`, and put the
 * old data back if it fails (the error still propagates, for the screen to explain).
 */
export function useOptimistic() {
  const qc = useQueryClient();
  return async <T>(key: QueryKey, change: (old: T) => T, action: () => Promise<unknown>) => {
    await qc.cancelQueries({ queryKey: key }); // an in-flight refetch must not overwrite the change
    const before = qc.getQueryData<T>(key);
    if (before !== undefined) qc.setQueryData<T>(key, change(before));
    try {
      await action();
    } catch (e) {
      qc.setQueryData(key, before);
      throw e;
    }
  };
}

// ---------- student ----------
export const useMe = (opts: { enabled?: boolean } = {}) => useLoad(qk.me, api.me, { live: true, ...opts });
export const useMyChallenges = (opts: { enabled?: boolean } = {}) =>
  useLoad(qk.myChallenges, api.myChallenges, { live: true, ...opts });
export const useTeams = () => useLoad(qk.teams, api.listTeams, { live: true });
