import type { StudentChallenge } from "@trip/shared";
import { api } from "../api.js";
import {
  Card, Celebrate, CheckRow, EmptyState, ErrorCard, PhaseTrail, Progress, ProgressRing, Skeleton, useAsync,
} from "../ui.js";
import { byVotingOrder } from "./vote-progress.js";

const BEFORE_VOTING = ["draft", "challenge"];

export function VoteHome() {
  const me = useAsync(() => api.me().catch(() => null), []);
  const list = useAsync(() => api.myChallenges(), []);

  if (me.loading || list.loading) return <Card><Skeleton lines={4} /></Card>;
  const phase = me.data?.phase;
  if (phase && phase !== "voting") {
    return <Card><VotingShut opensLater={BEFORE_VOTING.includes(phase)} /></Card>;
  }
  if (list.error || !list.data) return <ErrorCard error={list.error} onRetry={list.reload} />;

  const challenges = list.data.challenges;
  // Every challenge carries vote progress while voting is open; none once it has closed.
  if (challenges.length > 0 && challenges.every((c) => !c.vote)) return <Card><VotingShut /></Card>;
  const votable = challenges.filter((c) => c.vote && c.vote.status !== "not_enough");
  if (votable.length === 0) {
    return <Card><EmptyState icon="🗳️" title="Nothing to vote on yet" /></Card>;
  }
  const finished = votable.filter((c) => c.vote!.status === "done").length;

  return (
    <div className="stack">
      {phase && <div style={{ padding: "2px 2px 6px" }}><PhaseTrail phase={phase} variant="student" /></div>}
      {finished === votable.length ? (
        <Card><Celebrate icon="🎉" title="All voted!">Winners drop at the ceremony.</Celebrate></Card>
      ) : (
        <Card hero>
          <div className="row" style={{ marginBottom: 10 }}>
            <h2>Vote</h2>
            <span className="spacer" />
            <span className="muted tiny">{finished}/{votable.length} done</span>
          </div>
          <Progress value={finished} max={votable.length} label="Challenges voted" tone="sky" />
        </Card>
      )}
      <Card>
        {byVotingOrder(challenges).map((c) => <VoteRow key={c.id} c={c} />)}
      </Card>
    </div>
  );
}

function VoteRow({ c }: { c: StudentChallenge }) {
  const v = c.vote!;
  if (v.status === "not_enough") return <CheckRow state="todo" icon="⏳" title={c.title} meta="Waiting for photos" />;
  if (v.status === "done") return <CheckRow state="done" title={c.title} meta="All voted" />;
  return (
    <CheckRow
      state={v.status === "in_progress" ? "doing" : "todo"} title={c.title}
      meta={`${v.voted} of ${v.total} duels`} to={`/vote/${c.id}`}
      trailing={<ProgressRing value={v.voted} max={v.total} label={`${c.title} duels`} />}
    />
  );
}

function VotingShut({ opensLater = false }: { opensLater?: boolean }) {
  return opensLater
    ? <EmptyState icon="⏳" title="Voting opens soon" />
    : <EmptyState icon="🔒" title="Voting is closed" />;
}
