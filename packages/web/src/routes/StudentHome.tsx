import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorText, HttpError, isBadCode } from "../api.js";
import { qk, useMe, useRefresh, useTeams } from "../query.js";
import { Button, Card, ErrorCard, Field, PhasePill, PhaseTrail, Skeleton } from "../ui.js";
import { PlaySolo } from "./PlaySolo.js";

export function StudentHome() {
  const { data: me, error, loading, reload } = useMe();
  const teams = useTeams();
  const refresh = useRefresh();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  if (loading) return <Card><Skeleton /></Card>;

  // Not logged in -> offer manual code entry (QR/email link is the usual path).
  if (error instanceof HttpError && error.status === 401) {
    return (
      <Card hero>
        <h2>Enter your access code</h2>
        <p className="muted tiny" style={{ margin: "6px 0 12px" }}>
          Usually you'll open the link from your email, or scan a challenge QR.
        </p>
        <Field
          label="Access code" className="input-mono" value={code}
          placeholder="FOX-7Q2K" onChange={(e) => setCode(e.target.value)}
        />
        <Button
          size="block" style={{ marginTop: 4 }}
          onClick={async () => {
            try { await api.redeemCode(code.trim()); await refresh(qk.student); }
            catch (e) { setMsg(isBadCode(e) ? "That code is invalid or has already been used." : errorText(e)); }
          }}
        >
          Continue
        </Button>
        {msg && <p className="err tiny" style={{ marginBottom: 0 }}>{msg}</p>}
        <p className="tiny" style={{ marginTop: 16, marginBottom: 0 }}>
          <Link to="/teacher">I'm a teacher →</Link>
        </p>
      </Card>
    );
  }

  if (error || !me) return <ErrorCard error={error} onRetry={reload} />;
  const teamName = me.teamId ? teams.data?.teams.find((t) => t.id === me.teamId)?.name : null;

  return (
    <div className="stack">
      <div style={{ padding: "2px 2px 6px" }}>
        <PhaseTrail phase={me.phase} variant="student" />
      </div>

      <Card hero>
        <div className="row">
          <span className="crest">{me.teamId ? "🦊" : "🧭"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="tiny muted">{me.tripName}</div>
            <h2 style={{ margin: "2px 0 0" }}>{teamName ?? (me.teamId ? "Your team" : "No team yet")}</h2>
          </div>
          <PhasePill phase={me.phase} dot />
        </div>
      </Card>

      <NextAction phase={me.phase} inTeam={!!me.teamId} />
    </div>
  );
}

function NextAction({ phase, inTeam }: { phase: string; inTeam: boolean }) {
  if (phase === "draft") {
    return (
      <Card>
        <Action icon="🧑‍🤝‍🧑" title="Team up or play solo" body="Join or create a team before the challenge period starts. Playing solo? Create a team just for you." />
        <Link to="/team"><Button size="block" style={{ marginTop: 12 }}>Go to teams</Button></Link>
      </Card>
    );
  }
  if (phase === "challenge") {
    return (
      <Card>
        <Action icon="📸" title="Snap the challenges" body="Snap a photo for each one, then enter your best shot." />
        {inTeam
          ? <Link to="/challenges"><Button size="block" style={{ marginTop: 12 }}>See your challenges</Button></Link>
          : <div className="mt-3"><PlaySolo heading={false} /></div>}
      </Card>
    );
  }
  if (phase === "voting") {
    return (
      <Card>
        <Action icon="⚖️" title="Vote on the duels" body="Pick the better photo, as many times as you like." />
        <Link to="/vote"><Button size="block" style={{ marginTop: 12 }}>Start voting</Button></Link>
      </Card>
    );
  }
  return (
    <Card>
      <Action icon="🏆" title="Results are in" body="Ask your teacher to reveal the winners on the big screen!" />
    </Card>
  );
}

function Action({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
      <span className="action-ic">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p className="muted tiny" style={{ margin: "3px 0 0" }}>{body}</p>
      </div>
    </div>
  );
}
