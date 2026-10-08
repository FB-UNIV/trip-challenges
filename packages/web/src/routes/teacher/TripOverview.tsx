// Overview: the trip at a glance, and the "Now" card — what's ready, what's missing, and
// the one action that moves the trip on.
import { api, HttpError } from "../../api.js";
import { qk, useLoad } from "../../query.js";
import { Button, Card, CheckRow, ErrorCard, Notice, Skeleton, Stats, useAction, useConfirm } from "../../ui.js";
import { useTrip } from "./TripLayout.js";
import { nowPlan, type Plan } from "./now-plan.js";

export function TripOverview() {
  const { tripId, trip, reload, pending } = useTrip();
  const progress = useLoad(qk.tripPart(tripId, "progress"), () => api.tripProgress(tripId), { live: true });
  const roster = useLoad(qk.tripPart(tripId, "roster"), () => api.rosterStatus(tripId).catch(() => null), { live: true });
  const p = progress.data;
  return (
    <>
      <Stats items={[
        { label: "Students", value: p?.students ?? "—" },
        { label: "Teams", value: p?.teams ?? "—" },
        { label: "Challenges", value: p?.challenges.length ?? "—" },
        { label: "To review", value: pending.length, flag: pending.length > 0, to: `/teacher/trips/${tripId}/review` },
      ]} />
      {progress.error ? <ErrorCard error={progress.error} onRetry={progress.reload} />
        : !p || roster.loading ? <Card><Skeleton /></Card>
        : (
          <NowCard
            tripId={tripId} onMoved={reload}
            plan={nowPlan({
              phase: trip.phase, trip, progress: p, pending: pending.length,
              roster: roster.data ?? { pending: 0, done: 0, failed: 0, students: p.students },
            })}
          />
        )}
    </>
  );
}

function NowCard({ tripId, plan, onMoved }: { tripId: string; plan: Plan; onMoved: () => void }) {
  const confirm = useConfirm();
  const advance = useAction(async () => {
    const a = plan.action!;
    if (!(await confirm({ title: `${a.label}?`, body: a.confirm, confirmLabel: a.label }))) return;
    try {
      await api.advance(tripId, a.to);
    } catch (e) {
      // Refused = the trip already moved on (a co-teacher, or its planned date): catch up.
      if (!(e instanceof HttpError && e.status === 409)) throw e;
    }
    onMoved();
  }, "Could not move the trip on.");

  return (
    <Card hero>
      <h3>{plan.title}</h3>
      {plan.when && <p className="muted tiny mt-0 mb-0">{plan.when}</p>}
      {plan.eraseWarning && <div className="warncard mt-2"><b>{plan.eraseWarning}</b></div>}
      {plan.checks.length > 0 && (
        <div className="mt-2">
          {plan.checks.map((c, i) => (
            <CheckRow key={i} state={c.state} title={c.title} meta={c.meta} to={c.to && `/teacher/trips/${tripId}/${c.to}`} />
          ))}
        </div>
      )}
      {plan.action && (
        <Button size="block" className="mt-3" busy={advance.busy} onClick={advance.run}>{plan.action.label} →</Button>
      )}
      <Notice tone="err">{advance.error}</Notice>
    </Card>
  );
}
