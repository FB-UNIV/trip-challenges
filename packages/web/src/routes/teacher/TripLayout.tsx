// The trip desk: header, phase trail and section nav around the current section (an Outlet).
import { Navigate, Outlet, useOutletContext, useParams } from "react-router-dom";
import { api, type NominationRow } from "../../api.js";
import { qk, useLoad, useTripRefresh } from "../../query.js";
import { PhasePill, PhaseTrail, Pill, SectionNav, Skeleton, type Section } from "../../ui.js";

const PHASES = ["draft", "challenge", "voting", "reveal", "grace", "erased"];
export const rankOf = (p: string) => PHASES.indexOf(p);
export const hasResults = (phase: string) => rankOf(phase) >= rankOf("reveal");

export type TripCtx = {
  tripId: string;
  trip: any;
  reload: () => void;
  /** Nominations awaiting review; shared by the nav badge, the overview and the review section. */
  pending: NominationRow[];
  reloadPending: () => void;
  /** Set when the queue never loaded: the Review section must not show it as empty (#69). */
  pendingError: unknown;
};
export const useTrip = () => useOutletContext<TripCtx>();

export function TripLayout() {
  const { id } = useParams();
  // Live: the trip moves on by itself at its planned dates, or a co-teacher advances it.
  const trip = useLoad(qk.tripPart(id!, "info"), () => api.getTrip(id!), { live: true });
  const refreshTrip = useTripRefresh(id!);
  const phase: string | undefined = trip.data?.phase;
  // Waits for the trip: no point asking about an unknown (or not yet loaded) one.
  const noms = useLoad(
    qk.tripPart(id!, "nominations", "pending"),
    () => api.listNominations(id!, "pending"),
    { live: true, enabled: !!phase },
  );
  // Only the first load blanks the page: a reload after a save must keep the section
  // mounted, or its confirmation ("Saved.") vanishes before anyone sees it (#30).
  if (trip.loading && !trip.data) return <Skeleton />;
  const t = trip.data;
  if (!t) return <p className="err">Not found.</p>;

  const base = `/teacher/trips/${id}`;
  const pending = noms.data?.nominations ?? [];
  const sections: Section[] = [
    { to: `${base}/overview`, label: "Overview" },
    { to: `${base}/challenges`, label: "Challenges" },
    { to: `${base}/students`, label: "Students" },
    { to: `${base}/review`, label: "Review", badge: pending.length },
    ...(hasResults(t.phase) ? [{ to: `${base}/results`, label: "Results" }] : []),
    { to: `${base}/settings`, label: "Settings" },
  ];
  // Due but not erased yet: an "Erase now" or scheduled run failed and is being retried (#68).
  const erasurePending = t.phase !== "erased" && !!t.hard_erase_at && new Date(t.hard_erase_at) <= new Date();
  const pendingError = noms.error && !noms.data ? noms.error : null;
  const ctx: TripCtx = { tripId: id!, trip: t, reload: refreshTrip, pending, reloadPending: refreshTrip, pendingError };

  return (
    <div className="stack">
      <header className="trip-head">
        <div className="row">
          <h2 className="grow">{t.name}</h2>
          {erasurePending && <Pill tone="warn">Erasure pending</Pill>}
          <PhasePill phase={t.phase} dot />
        </div>
        <PhaseTrail phase={t.phase} variant="teacher" />
        <SectionNav label="Trip sections" items={sections} />
      </header>
      {/* Remount on a phase change so phase-dependent lists refetch. */}
      <div key={t.phase} className="stack">
        <Outlet context={ctx} />
      </div>
    </div>
  );
}

/** /teacher/trips/:id → the section that matters now. */
export function TripLanding() {
  const { trip } = useTrip();
  return <Navigate to={trip.phase === "reveal" ? "results" : "overview"} replace />;
}
