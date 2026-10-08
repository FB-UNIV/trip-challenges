// Teacher home: sign-in gate, the teacher's trips as cards (past ones apart), new trip on demand.
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, HttpError, type TripSummary } from "../../api.js";
import { qk, useLoad } from "../../query.js";
import { Button, Card, EmptyState, Field, Notice, PhasePill, Skeleton, useAction } from "../../ui.js";

export function TeacherHome() {
  const me = useLoad(qk.teacherMe, api.teacherMe);
  const trips = useLoad(qk.trips, () => api.listTrips().catch(() => ({ trips: [] as TripSummary[] })));
  const [creating, setCreating] = useState(false);

  if (me.loading) return <Skeleton />;

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

  const all = trips.data?.trips ?? [];
  const active = all.filter((t) => t.phase !== "erased");
  const past = all.filter((t) => t.phase === "erased");
  const empty = trips.data !== null && all.length === 0;

  return (
    <div className="stack">
      <section className="stack" aria-labelledby="trips-h">
        <div className="row">
          <h2 id="trips-h" className="grow">Your trips</h2>
          {trips.data && !empty && !creating && <Button variant="soft" onClick={() => setCreating(true)}>New trip</Button>}
        </div>
        {trips.loading && !trips.data ? <Card><Skeleton /></Card>
          : empty ? <Card><EmptyState icon="🧳" title="No trips yet" /></Card>
          : <div className="trip-cards">{active.map((t) => <TripCard key={t.id} t={t} />)}</div>}
      </section>

      {(creating || empty) && (
        <NewTrip onCreated={() => { setCreating(false); trips.reload(); }} onCancel={empty ? undefined : () => setCreating(false)} />
      )}

      {past.length > 0 && (
        <section className="stack" aria-labelledby="past-h">
          <h3 id="past-h" className="muted">Past trips</h3>
          <div className="trip-cards">{past.map((t) => <TripCard key={t.id} t={t} />)}</div>
        </section>
      )}
    </div>
  );
}

const endDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function TripCard({ t }: { t: TripSummary }) {
  return (
    <Link to={`/teacher/trips/${t.id}`} className={`trip-card p-${t.phase}`}>
      <span className="trip-card-top">
        <b>{t.name}</b>
        <PhasePill phase={t.phase} dot />
      </span>
      <span className="d">{t.role === "owner" ? "Owner" : "Co-teacher"} · ends {endDate(t.trip_end_date)}</span>
    </Link>
  );
}

function NewTrip({ onCreated, onCancel }: { onCreated: () => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [endDate, setEndDate] = useState("");
  const [maxTeamSize, setMaxTeamSize] = useState("4");
  const create = useAction(async () => {
    await api.createTrip({ name: name.trim(), tripEndDate: endDate, maxTeamSize: Number(maxTeamSize) });
    onCreated();
  }, "Could not create the trip.");
  return (
    <Card hero>
      <h3>New trip</h3>
      <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid2">
        <Field label="Trip end date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <Field label="Max team size" type="number" min={1} value={maxTeamSize} onChange={(e) => setMaxTeamSize(e.target.value)} />
      </div>
      <div className="row">
        <Button disabled={!name.trim() || !endDate} busy={create.busy} onClick={create.run}>Create trip</Button>
        {onCancel && <Button variant="neutral" onClick={onCancel}>Cancel</Button>}
      </div>
      <Notice tone="err">{create.error}</Notice>
    </Card>
  );
}
