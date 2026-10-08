// Results: Grand Champion tie-break and the ceremony launcher (reveal onwards).
import { Navigate } from "react-router-dom";
import { api, type ResultRow } from "../../api.js";
import { qk, useLoad, useTripRefresh } from "../../query.js";
import { Button, Card, EmptyState, Notice, useAction } from "../../ui.js";
import { hasResults, useTrip } from "./TripLayout.js";

export function TripResults() {
  const { tripId, trip } = useTrip();
  if (!hasResults(trip.phase)) return <Navigate to={`/teacher/trips/${tripId}/overview`} replace />;
  return <Results tripId={tripId} phase={trip.phase} />;
}

function Results({ tripId, phase }: { tripId: string; phase: string }) {
  const res = useLoad(qk.tripPart(tripId, "results"), () => api.results(tripId).catch(() => ({ results: [] as ResultRow[] })));
  const refreshTrip = useTripRefresh(tripId);
  const results = res.data?.results ?? [];
  const champions = results.filter((r) => r.is_grand_champion);

  return (
    <Card>
      <h3>Results &amp; ceremony</h3>
      {phase === "reveal" && (
        <p className="muted tiny mt-0">
          Students can't see the results yet. After the ceremony, publish them from the Overview.
        </p>
      )}

      {/* Grand Champion tie — the teacher picks one (CONTEXT: Grand Champion). */}
      {phase === "reveal" && champions.length > 1 && (
        <div className="warncard mt-2">
          <b>It's a tie for Grand Champion — pick the winner:</b>
          {champions.map((c) => <Crown key={c.id} tripId={tripId} team={c} onCrowned={() => void refreshTrip()} />)}
        </div>
      )}

      {results.length > 0 ? (
        <>
          <Button variant="gold" className="mt-3" onClick={() => window.open(`/ceremony/${tripId}`, "_blank", "noopener")}>
            🏆 Launch ceremony
          </Button>
          <div className="results-list mt-3">
            {results.map((r) => (
              <div key={r.id} className={r.is_grand_champion ? "result-row result-champ" : "result-row"}>
                {r.is_grand_champion ? "🏆 " : `${r.challenge_title} #${r.placement} — `}
                {r.team_name_vetted} ({r.points} pts)
              </div>
            ))}
          </div>
        </>
      ) : res.data && <EmptyState icon="🏁" title="No results" />}
    </Card>
  );
}

function Crown({ tripId, team, onCrowned }: { tripId: string; team: ResultRow; onCrowned: () => void }) {
  const crown = useAction(async () => { await api.setGrandChampion(tripId, team.id); onCrowned(); }, "Could not crown this team.");
  return (
    <div className="mt-2">
      <div className="row">
        <span className="grow">{team.team_name_vetted} ({team.points} pts)</span>
        <Button size="mini" busy={crown.busy} onClick={crown.run}>Crown this team</Button>
      </div>
      <Notice tone="err">{crown.error}</Notice>
    </div>
  );
}
