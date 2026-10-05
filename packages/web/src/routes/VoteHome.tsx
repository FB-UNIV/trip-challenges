import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Card, PhaseTrail, useAsync } from "../ui.js";

export function VoteHome() {
  const me = useAsync(() => api.me().catch(() => null), []);
  const list = useAsync(() => api.myChallenges(), []);

  if (list.loading) return <p className="muted">Loading…</p>;
  if (me.data && me.data.phase !== "voting") {
    return <Card><p className="muted" style={{ margin: 0 }}>Voting isn't open yet (phase: {me.data.phase}).</p></Card>;
  }
  return (
    <div className="stack">
      {me.data && <div style={{ padding: "2px 2px 6px" }}><PhaseTrail phase={me.data.phase} variant="student" /></div>}
      <Card hero>
        <h2>Vote</h2>
        <p className="muted tiny" style={{ margin: "6px 0 0" }}>Pick the better photo in each duel. Vote as many as you like — every duel helps decide the winners.</p>
      </Card>
      <Card>
        <h3>Challenges</h3>
        {list.data?.challenges.length === 0 && <p className="muted">No challenges to vote on yet.</p>}
        {list.data?.challenges.map((c) => (
          <Link key={c.id} to={`/vote/${c.id}`} className="list-row" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="grow"><b>{c.title}</b></div>
            <span className="pill pill-sky"><span className="dot" />Vote →</span>
          </Link>
        ))}
      </Card>
    </div>
  );
}
