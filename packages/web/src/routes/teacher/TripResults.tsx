// Results: Grand Champion tie-break and the ceremony launcher (reveal onwards).
import { Navigate } from "react-router-dom";
import { api } from "../../api.js";
import { Button, Card, useAsync } from "../../ui.js";
import { hasResults, useTrip } from "./TripLayout.js";

export function TripResults() {
  const { tripId, trip } = useTrip();
  if (!hasResults(trip.phase)) return <Navigate to={`/teacher/trips/${tripId}/overview`} replace />;
  return <Results tripId={tripId} phase={trip.phase} />;
}

function Results({ tripId, phase }: { tripId: string; phase: string }) {
  const res = useAsync(() => api.results(tripId).catch(() => ({ results: [] })), [tripId]);
  const results = res.data?.results ?? [];
  const champions = results.filter((r) => r.is_grand_champion);

  return (
    <Card>
      <h3>Results &amp; ceremony</h3>
      {phase === "reveal" && (
        <p className="muted tiny" style={{ marginTop: 4 }}>
          Results are hidden from students until you advance to <b>grace</b> — do that when the ceremony is done.
        </p>
      )}

      {/* Grand Champion tie — the teacher picks one (CONTEXT: Grand Champion). */}
      {phase === "reveal" && champions.length > 1 && (
        <div className="warncard" style={{ margin: "8px 0" }}>
          <b>It's a tie for Grand Champion — pick the winner:</b>
          {champions.map((c) => (
            <div key={c.id} className="row" style={{ marginTop: 6 }}>
              <span style={{ flex: 1 }}>{c.team_name_vetted} ({c.points} pts)</span>
              <Button size="mini" onClick={async () => { await api.setGrandChampion(tripId, c.id); res.reload(); }}>Crown this team</Button>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <Button
          variant="gold" style={{ marginBottom: 10 }}
          onClick={() => window.open(`/ceremony/${tripId}`, "_blank", "noopener")}
        >🏆 Launch ceremony</Button>
      )}
      {results.map((r) => (
        <div key={r.id} style={{ padding: "4px 0", fontWeight: r.is_grand_champion ? 700 : 400 }}>
          {r.is_grand_champion ? "🏆 " : `${r.challenge_title} #${r.placement} — `}
          {r.team_name_vetted} ({r.points} pts)
        </div>
      ))}
    </Card>
  );
}
