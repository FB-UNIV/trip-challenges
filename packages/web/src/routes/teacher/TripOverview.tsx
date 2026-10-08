// Overview: the trip at a glance and the lifecycle control.
import { api } from "../../api.js";
import { Button, Card, PhasePill, Stats, useAsync } from "../../ui.js";
import { useTrip } from "./TripLayout.js";

const NEXT: Record<string, string> = { draft: "challenge", challenge: "voting", voting: "reveal", reveal: "grace" };

export function TripOverview() {
  const { tripId, trip, reload, pending } = useTrip();
  const roster = useAsync(() => api.rosterStatus(tripId).catch(() => null), [tripId]);
  const ch = useAsync(() => api.listChallenges(tripId).catch(() => ({ challenges: [] })), [tripId]);
  return (
    <>
      <Stats items={[
        { label: "Students", value: roster.data?.students ?? "—" },
        { label: "Codes emailed", value: roster.data?.done ?? "—" },
        { label: "Challenges", value: ch.data?.challenges.length ?? "—" },
        { label: "To review", value: pending.length, flag: pending.length > 0, to: `/teacher/trips/${tripId}/review` },
      ]} />
      <PhaseControl tripId={tripId} phase={trip.phase} onChange={reload} />
    </>
  );
}

function PhaseControl({ tripId, phase, onChange }: { tripId: string; phase: string; onChange: () => void }) {
  const next = NEXT[phase];
  return (
    <Card>
      <div className="row">
        <h3 style={{ flex: 1 }}>Lifecycle</h3>
        <PhasePill phase={phase} dot />
      </div>
      <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
        {next && (
          <Button
            onClick={async () => {
              // Refused = the trip already moved on (a co-teacher, or its planned date): either way, catch up.
              try { await api.advance(tripId, next); } catch { /* the reload shows where it is now */ }
              onChange();
            }}
          >Advance to {next} →</Button>
        )}
      </div>
    </Card>
  );
}
