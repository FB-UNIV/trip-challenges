import { useState } from "react";
import { Link } from "react-router-dom";
import { api, HttpError } from "../../api.js";
import { Button, Card, Field, PhasePill, useAsync } from "../../ui.js";

export function TeacherHome() {
  const me = useAsync(() => api.teacherMe(), []);
  const trips = useAsync(() => api.listTrips().catch(() => ({ trips: [] })), []);
  const [name, setName] = useState("");
  const [endDate, setEndDate] = useState("");
  const [maxTeamSize, setMaxTeamSize] = useState("4");
  const [err, setErr] = useState("");

  if (me.loading) return <p className="muted">Loading…</p>;

  if (me.error instanceof HttpError && me.error.status === 401) {
    return (
      <Card hero>
        <h2>Teacher sign-in</h2>
        <p className="muted" style={{ margin: "6px 0 12px" }}>Authenticate with your PocketID account to manage your trips.</p>
        <Button onClick={() => (window.location.href = "/api/auth/teacher/login")}>
          Sign in with PocketID
        </Button>
      </Card>
    );
  }

  return (
    <div className="stack">
      <Card>
        <h2>Trips</h2>
        {trips.data?.trips.length === 0 && <p className="muted">No trips yet — create your first one below.</p>}
        {trips.data?.trips.map((t) => (
          <Link key={t.id} to={`/teacher/trips/${t.id}`} className="list-row" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="grow">
              <b>{t.name}</b>
              <div className="d">{t.role}</div>
            </div>
            <PhasePill phase={t.phase} dot />
          </Link>
        ))}
      </Card>

      <Card hero>
        <h3>New trip</h3>
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row" style={{ gap: 10 }}>
          <Field label="Trip end date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <Field label="Max team size" type="number" value={maxTeamSize} onChange={(e) => setMaxTeamSize(e.target.value)} />
        </div>
        <Button
          disabled={!name.trim() || !endDate}
          onClick={async () => {
            setErr("");
            try {
              await api.createTrip({ name: name.trim(), tripEndDate: endDate, maxTeamSize: Number(maxTeamSize) });
              setName(""); setEndDate("");
              trips.reload();
            } catch (e) {
              setErr(`Could not create the trip${e instanceof HttpError ? `: ${e.reason}` : "."}`);
            }
          }}
        >Create trip</Button>
        {err && <p className="err tiny" style={{ marginBottom: 0 }}>{err}</p>}
      </Card>
    </div>
  );
}
