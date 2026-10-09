// My challenge checklist: what's left to snap, what's entered. Each row opens the same
// page as the challenge's printed QR code.
import { Link } from "react-router-dom";
import type { StudentChallenge } from "@trip/shared";
import { useMe, useMyChallenges } from "../query.js";
import { PlaySolo } from "./PlaySolo.js";
import {
  Card, Celebrate, CheckRow, EmptyState, ErrorCard, PhaseTrail, Progress, Skeleton, type CheckState,
} from "../ui.js";

// A rejected entry (#81) is a to-do again: the team picks another photo while it still can.
const rejected = (c: StudentChallenge) => !c.nominated && c.entry === "rejected";
const stateOf = (c: StudentChallenge): CheckState =>
  c.nominated ? "done" : c.photos > 0 || rejected(c) ? "doing" : "todo";
const ORDER: Record<CheckState, number> = { doing: 0, todo: 1, done: 2 };
const photos = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`;
/** `open`: photos can still be nominated (challenge phase). */
function metaOf(c: StudentChallenge, open: boolean): string {
  if (c.nominated) return c.entry === "approved" ? "Entered ⭐ · Approved ✅" : "Entered ⭐ · Waiting for your teacher ⏳";
  if (rejected(c)) return open ? "Not accepted · pick another photo" : "Not accepted";
  return c.photos > 0 ? `${photos(c.photos)} · pick one` : "No photo yet";
}

export function ChallengesPage() {
  const me = useMe();
  const list = useMyChallenges();

  if (me.loading || list.loading) return <Card><Skeleton lines={4} /></Card>;
  if (me.error || list.error || !me.data || !list.data) {
    return <ErrorCard error={me.error ?? list.error} onRetry={() => { me.reload(); list.reload(); }} />;
  }
  const { phase, teamId } = me.data;
  const challenges = list.data.challenges;
  if (challenges.length === 0) return <Card><EmptyState icon="🗺️" title="No challenges yet" /></Card>;

  const trail = <div style={{ padding: "2px 2px 6px" }}><PhaseTrail phase={phase} variant="student" /></div>;

  if (phase === "draft") {
    return (
      <div className="stack">
        {trail}
        <Card><EmptyState icon="🔒" title="Unlocks when the trip starts" /></Card>
        <Card>{challenges.map((c) => <CheckRow key={c.id} state="todo" title={c.title} />)}</Card>
      </div>
    );
  }
  if (phase !== "challenge") {
    return (
      <div className="stack">
        {trail}
        <Card>
          <EmptyState icon="⏰" title="Photo time's over">
            {phase === "voting" && <Link to="/vote" className="btn">Go vote →</Link>}
          </EmptyState>
        </Card>
        <Card>{challenges.map((c) => <CheckRow key={c.id} state={stateOf(c)} title={c.title} meta={metaOf(c, false)} />)}</Card>
      </div>
    );
  }
  if (!teamId) {
    return (
      <Card>
        <PlaySolo />
      </Card>
    );
  }

  const entered = challenges.filter((c) => c.nominated).length;
  const sorted = [...challenges].sort((a, b) => ORDER[stateOf(a)] - ORDER[stateOf(b)]);
  return (
    <div className="stack">
      {trail}
      {entered === challenges.length ? (
        <Card><Celebrate icon="🏅" title="All entered!">Swap in a better shot any time before voting.</Celebrate></Card>
      ) : (
        <Card hero>
          <div className="row" style={{ marginBottom: 10 }}>
            <h2>Challenges</h2>
            <span className="spacer" />
            <span className="muted tiny">{entered}/{challenges.length} entered</span>
          </div>
          <Progress value={entered} max={challenges.length} label="Challenges entered" tone="coral" />
        </Card>
      )}
      <Card>
        {sorted.map((c) => (
          <CheckRow key={c.id} state={stateOf(c)} title={c.title} meta={metaOf(c, true)} to={`/c/${c.qrSlug}`} />
        ))}
      </Card>
    </div>
  );
}
