// Settings: trip configuration, co-teachers, and erasure (kept apart from everyday controls).
import { useState } from "react";
import { api } from "../../api.js";
import { Button, Card, Field, Notice, Pill, useAction, useAsync, useConfirm } from "../../ui.js";
import { rankOf, useTrip } from "./TripLayout.js";

export function TripSettings() {
  const { tripId, trip, reload } = useTrip();
  return (
    <div className="admin-grid">
      <Settings tripId={tripId} trip={trip} onSaved={reload} />
      <CoTeachers tripId={tripId} />
      {trip.phase !== "erased" && <DangerZone tripId={tripId} name={trip.name} onErased={reload} />}
    </div>
  );
}

function DangerZone({ tripId, name, onErased }: { tripId: string; name: string; onErased: () => void }) {
  const confirm = useConfirm();
  const erase = useAction(async () => {
    const ok = await confirm({
      title: "Erase all student data?",
      body: <>Photos, teams, votes and roster emails for <b>{name}</b> are destroyed for good. Only the results, without photos, are kept.</>,
      confirmLabel: "Erase now", danger: true, typeToConfirm: name,
    });
    if (!ok) return;
    await api.erase(tripId);
    onErased();
  }, "Could not erase the trip.");
  return (
    <Card className="card-danger">
      <h3>Danger zone</h3>
      <p className="muted tiny">
        Erasure happens by itself after the grace period. Erase now only if the trip must end early. This cannot be undone.
      </p>
      <Button variant="danger" busy={erase.busy} onClick={erase.run}>Erase all student data…</Button>
      <Notice tone="err">{erase.error}</Notice>
    </Card>
  );
}

// <input type="datetime-local"> works in the teacher's local time; the API stores instants.
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function Settings({ tripId, trip, onSaved }: { tripId: string; trip: any; onSaved: () => void }) {
  const draft = trip.phase === "draft";
  const beforeReveal = rankOf(trip.phase) < rankOf("reveal");
  const editable = trip.phase !== "erased";

  const initial = {
    name: trip.name ?? "",
    maxTeamSize: String(trip.max_team_size ?? 4),
    graceDays: String(trip.grace_days ?? 7),
    maxRetentionDays: String(trip.max_retention_days ?? 30),
    tripEndDate: String(trip.trip_end_date ?? "").slice(0, 10),
    challengeOpensAt: toLocalInput(trip.challenge_opens_at),
    votingOpensAt: toLocalInput(trip.voting_opens_at),
    votingClosesAt: toLocalInput(trip.voting_closes_at),
  };
  const [form, setForm] = useState(initial);
  const [points, setPoints] = useState<{ placement: number; points: number }[]>(
    () => (trip.points_table ?? []).map((r: any) => ({ placement: r.placement, points: r.points })),
  );
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  if (!editable) return null;
  const set = (k: keyof typeof form) => (e: any) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setMsg(""); setErr("");
    const patch: Record<string, unknown> = {};
    if (form.name !== initial.name) patch.name = form.name;
    if (form.graceDays !== initial.graceDays) patch.graceDays = Number(form.graceDays);
    if (form.maxRetentionDays !== initial.maxRetentionDays) patch.maxRetentionDays = Number(form.maxRetentionDays);
    if (form.tripEndDate !== initial.tripEndDate) patch.tripEndDate = form.tripEndDate;
    for (const k of ["challengeOpensAt", "votingOpensAt", "votingClosesAt"] as const) {
      if (form[k] !== initial[k]) patch[k] = fromLocalInput(form[k]);
    }
    if (draft && form.maxTeamSize !== initial.maxTeamSize) patch.maxTeamSize = Number(form.maxTeamSize);
    const normPoints = points.map((p, i) => ({ placement: i + 1, points: Number(p.points) }));
    if (beforeReveal && JSON.stringify(normPoints) !== JSON.stringify(trip.points_table ?? [])) {
      patch.pointsTable = normPoints;
    }
    if (Object.keys(patch).length === 0) { setMsg("No changes."); return; }
    try {
      await api.updateTrip(tripId, patch);
      setMsg("Saved.");
      onSaved();
    } catch (e: any) {
      setErr(e?.message?.includes("locked_in_phase") ? "Some fields aren't editable in this phase." : "Could not save.");
    }
  };

  return (
    <Card>
      <h3>Settings</h3>
      <Field label="Trip name" value={form.name} onChange={set("name")} />
      <Field
        label={`Max team size${draft ? "" : " (locked — teams are formed)"}`}
        type="number" value={form.maxTeamSize} onChange={set("maxTeamSize")} disabled={!draft}
      />
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <Field label="Grace days" type="number" value={form.graceDays} onChange={set("graceDays")} />
        <Field label="Max retention days" type="number" value={form.maxRetentionDays} onChange={set("maxRetentionDays")} />
      </div>
      <Field label="Trip end date" type="date" value={form.tripEndDate} onChange={set("tripEndDate")} />

      <div style={{ marginTop: 10, fontWeight: 700, fontSize: 14 }}>Planned dates</div>
      <p className="muted tiny" style={{ margin: "2px 0 6px" }}>
        The trip moves on by itself: challenges open, then voting opens. Voting stops at its
        close time; you start the reveal ceremony yourself.
      </p>
      <Field label="Challenge opens" type="datetime-local" value={form.challengeOpensAt} onChange={set("challengeOpensAt")} />
      <Field label="Voting opens" type="datetime-local" value={form.votingOpensAt} onChange={set("votingOpensAt")} />
      <Field label="Voting closes" type="datetime-local" value={form.votingClosesAt} onChange={set("votingClosesAt")} />

      <div style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          Points table{beforeReveal ? "" : " (locked — results computed)"}
        </div>
        {points.map((p, i) => (
          <div key={i} className="row" style={{ margin: "6px 0" }}>
            <span className="mono-tag">#{i + 1}</span>
            <input
              type="number" value={p.points} disabled={!beforeReveal} className="input"
              onChange={(e) => setPoints(points.map((q, j) => (j === i ? { ...q, points: Number(e.target.value) } : q)))}
              style={{ width: 90 }}
            />
            <span className="muted tiny">pts</span>
          </div>
        ))}
        {beforeReveal && (
          <div className="row" style={{ marginTop: 6 }}>
            <Button variant="neutral" size="mini" onClick={() => setPoints([...points, { placement: points.length + 1, points: 0 }])}>+ placement</Button>
            {points.length > 0 && (
              <Button variant="neutral" size="mini" onClick={() => setPoints(points.slice(0, -1))}>− remove last</Button>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}><Button onClick={save}>Save settings</Button></div>
      {msg && <p className="ok tiny" style={{ marginBottom: 0 }}>{msg}</p>}
      {err && <p className="err tiny" style={{ marginBottom: 0 }}>{err}</p>}
    </Card>
  );
}

function CoTeachers({ tripId }: { tripId: string }) {
  const teachers = useAsync(() => api.listTripTeachers(tripId), [tripId]);
  const invites = useAsync(() => api.listInvites(tripId).catch(() => ({ invites: [] })), [tripId]);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const reload = () => { teachers.reload(); invites.reload(); };

  return (
    <Card>
      <h3>Teachers</h3>
      {teachers.data?.teachers.map((t) => (
        <div key={t.id} className="row" style={{ padding: "5px 0" }}>
          <span style={{ flex: 1 }}>{t.email}</span>
          <Pill tone={t.role === "owner" ? "accent" : "neutral"}>{t.role}</Pill>
        </div>
      ))}

      {invites.data && invites.data.invites.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted tiny">Pending invites</div>
          {invites.data.invites.map((iv) => (
            <div key={iv.id} className="row" style={{ padding: "3px 0" }}>
              <span style={{ flex: 1 }}>{iv.email}</span>
              <Button variant="neutral" size="mini" onClick={async () => { await api.revokeInvite(tripId, iv.id); reload(); }}>Revoke</Button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Field label="Invite co-teacher by email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button
          disabled={!email.trim()}
          onClick={async () => {
            setMsg(""); setErr("");
            try {
              const r = await api.invite(tripId, email.trim());
              setMsg(`Invite emailed to ${r.invited}.`);
              setEmail(""); reload();
            } catch (e: any) {
              setErr(e?.message?.includes("already_member") ? "Already a teacher on this trip."
                : e?.message?.includes("forbidden") ? "Only the trip owner can invite co-teachers."
                : "Could not send invite.");
            }
          }}
        >Send invite</Button>
        {msg && <p className="ok tiny" style={{ marginBottom: 0 }}>{msg}</p>}
        {err && <p className="err tiny" style={{ marginBottom: 0 }}>{err}</p>}
      </div>
    </Card>
  );
}
