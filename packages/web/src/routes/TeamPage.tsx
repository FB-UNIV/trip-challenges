import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Field, useAsync } from "../ui.js";

export function TeamPage() {
  const me = useAsync(() => api.me(), []);
  const teams = useAsync(() => api.listTeams(), []);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  if (me.loading || teams.loading) return <p className="muted">Loading…</p>;
  const inTeam = !!me.data?.teamId;
  const locked = me.data?.phase !== "draft";

  const act = (fn: () => Promise<unknown>) => async () => {
    setErr("");
    try {
      await fn();
      me.reload();
      teams.reload();
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    }
  };

  if (locked) {
    return (
      <Card>
        <h2>Teams are locked</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          The challenge period has started, so team membership is fixed. <Link to="/">Back home</Link>
        </p>
      </Card>
    );
  }

  return (
    <div className="stack">
      <Card hero>
        <h2>Your team</h2>
        {inTeam ? (
          <>
            <p className="muted tiny" style={{ margin: "6px 0 12px" }}>You're all set. You can still leave to switch teams until the challenge starts.</p>
            <Button variant="ghost" onClick={act(() => api.leaveTeam())}>Leave team</Button>
          </>
        ) : (
          <>
            <p className="muted tiny" style={{ margin: "6px 0 4px" }}>Create your own, or join one below.</p>
            <Field label="New team name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button disabled={!name.trim()} onClick={act(() => api.createTeam(name.trim()))}>Create team</Button>
          </>
        )}
        {err && <p className="err tiny" style={{ marginBottom: 0 }}>{err}</p>}
      </Card>

      {!inTeam && (
        <Card>
          <h3>Join a team</h3>
          {teams.data?.teams.length === 0 && <p className="muted">No teams yet — create the first one.</p>}
          {teams.data?.teams.map((t) => (
            <div key={t.id} className="list-row">
              <div className="grow">
                <b>{t.name}</b>
                <div className="d">{t.members} {t.members === 1 ? "member" : "members"}</div>
              </div>
              <Button size="mini" onClick={act(() => api.joinTeam(t.id))}>Join</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
