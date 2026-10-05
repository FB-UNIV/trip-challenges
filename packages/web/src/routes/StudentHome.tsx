import { useState } from "react";
import { Link } from "react-router-dom";
import { api, HttpError } from "../api.js";
import { Button, Card, Field, PhasePill, PhaseTrail, useAsync } from "../ui.js";

export function StudentHome() {
  const { data: me, error, loading, reload } = useAsync(() => api.me(), []);
  const teams = useAsync(() => api.listTeams().catch(() => null), []);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  if (loading) return <p className="muted">Loading…</p>;

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
            try { await api.redeemCode(code.trim()); reload(); }
            catch { setMsg("That code is invalid or has already been used."); }
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

  if (!me) return <p className="err">Something went wrong.</p>;
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
        <Action icon="🧑‍🤝‍🧑" title="Form or join your team" body="Teams lock when the challenge period starts — sort yours now." />
        <Link to="/team"><Button size="block" style={{ marginTop: 12 }}>Go to teams</Button></Link>
      </Card>
    );
  }
  if (phase === "challenge") {
    return (
      <Card>
        <Action icon="📷" title="Scan a challenge" body={inTeam ? "Find a printed QR, snap your photo, then nominate your best shot." : "Join a team first, then scan a challenge QR to upload."} />
        {!inTeam && <Link to="/team"><Button size="block" style={{ marginTop: 12 }}>Join a team</Button></Link>}
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
