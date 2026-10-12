// Settings: trip configuration, co-teachers, and erasure (kept apart from everyday controls).
import { useState } from "react";
import { api, errorText, HttpError } from "../../api.js";
import { qk, useLoad, useTripRefresh } from "../../query.js";
import { Button, Card, ErrorCard, Field, Notice, Pill, useAction, useConfirm } from "../../ui.js";
import { rankOf, useTrip } from "./TripLayout.js";

export function TripSettings() {
  const { tripId, trip, reload } = useTrip();
  return (
    <div className="admin-grid">
      <Settings tripId={tripId} trip={trip} onSaved={reload} />
      <CoTeachers tripId={tripId} />
      {trip.phase === "erased"
        ? <Card><Notice tone="ok">Données des élèves effacées. Seuls les résultats, sans les photos, sont conservés.</Notice></Card>
        : <DangerZone tripId={tripId} name={trip.name} onErased={reload} />}
    </div>
  );
}

function DangerZone({ tripId, name, onErased }: { tripId: string; name: string; onErased: () => void }) {
  const confirm = useConfirm();
  const erase = useAction(async () => {
    const ok = await confirm({
      title: "Effacer toutes les données des élèves ?",
      body: <>Les photos, équipes, votes et e-mails des élèves de <b>{name}</b> sont détruits définitivement. Seuls les résultats, sans les photos, sont conservés.</>,
      confirmLabel: "Effacer maintenant", danger: true, typeToConfirm: name,
    });
    if (!ok) return;
    // Reload either way: a failed erase leaves the trip due (header: "Erasure pending").
    try { await api.erase(tripId); } finally { onErased(); }
  }, "Impossible d'effacer la sortie.");
  return (
    <Card className="card-danger">
      <h3>Zone de danger</h3>
      <p className="muted tiny">
        L'effacement se fait automatiquement après le délai de grâce. N'efface maintenant que si la sortie doit se terminer plus tôt. C'est irréversible.
      </p>
      <Button variant="danger" busy={erase.busy} onClick={erase.run}>Effacer toutes les données des élèves…</Button>
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
    if (Object.keys(patch).length === 0) { setMsg("Aucune modification."); return; }
    try {
      await api.updateTrip(tripId, patch);
      setMsg("Enregistré.");
      onSaved();
    } catch (e: any) {
      setErr(e instanceof HttpError && e.code === "locked_in_phase" ? "Certains champs ne sont pas modifiables dans cette phase." : errorText(e, "Impossible d'enregistrer."));
    }
  };

  return (
    <Card>
      <h3>Paramètres</h3>
      <Field label="Nom de la sortie" value={form.name} onChange={set("name")} />
      <Field
        label={`Taille max. d'une équipe${draft ? "" : " (verrouillée — les équipes sont formées)"}`}
        type="number" value={form.maxTeamSize} onChange={set("maxTeamSize")} disabled={!draft}
      />
      <div className="grid2">
        <Field label="Délai de grâce (jours)" type="number" value={form.graceDays} onChange={set("graceDays")} />
        <Field label="Conservation max. (jours)" type="number" value={form.maxRetentionDays} onChange={set("maxRetentionDays")} />
      </div>
      <Field label="Date de fin de la sortie" type="date" value={form.tripEndDate} onChange={set("tripEndDate")} />

      <div className="settings-sub">Dates prévues</div>
      <p className="muted tiny mt-0">
        La sortie avance toute seule : les défis s'ouvrent, puis le vote. Le vote s'arrête à
        l'heure de clôture ; c'est toi qui lances la cérémonie de révélation.
      </p>
      <Field label="Ouverture des défis" type="datetime-local" value={form.challengeOpensAt} onChange={set("challengeOpensAt")} />
      <Field label="Ouverture du vote" type="datetime-local" value={form.votingOpensAt} onChange={set("votingOpensAt")} />
      <Field label="Clôture du vote" type="datetime-local" value={form.votingClosesAt} onChange={set("votingClosesAt")} />

      <div>
        <div className="settings-sub">
          Barème des points{beforeReveal ? "" : " (verrouillé — résultats calculés)"}
        </div>
        {points.map((p, i) => (
          <div key={i} className="row points-row">
            <span className="mono-tag">#{i + 1}</span>
            <input
              type="number" value={p.points} disabled={!beforeReveal} className="input"
              aria-label={`Points pour la place ${i + 1}`}
              onChange={(e) => setPoints(points.map((q, j) => (j === i ? { ...q, points: Number(e.target.value) } : q)))}
            />
            <span className="muted tiny">pts</span>
          </div>
        ))}
        {beforeReveal && (
          <div className="row mt-2">
            <Button variant="neutral" size="mini" onClick={() => setPoints([...points, { placement: points.length + 1, points: 0 }])}>+ place</Button>
            {points.length > 0 && (
              <Button variant="neutral" size="mini" onClick={() => setPoints(points.slice(0, -1))}>− retirer la dernière</Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3"><Button onClick={save}>Enregistrer les paramètres</Button></div>
      <Notice tone="ok">{msg}</Notice>
      <Notice tone="err">{err}</Notice>
    </Card>
  );
}

function CoTeachers({ tripId }: { tripId: string }) {
  const teachers = useLoad(qk.tripPart(tripId, "teachers"), () => api.listTripTeachers(tripId));
  const invites = useLoad(qk.tripPart(tripId, "invites"), () => api.listInvites(tripId));
  const refreshTrip = useTripRefresh(tripId);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const reload = () => void refreshTrip();

  return (
    <Card>
      <h3>Enseignants</h3>
      {teachers.data?.teachers.map((t) => (
        <div key={t.id} className="row people-row">
          <span>{t.email}</span>
          <Pill tone={t.role === "owner" ? "accent" : "neutral"}>{t.role === "owner" ? "Responsable" : "Co-enseignant"}</Pill>
        </div>
      ))}

      {invites.error && !invites.data && <ErrorCard inline error={invites.error} onRetry={invites.reload} />}
      {invites.data && invites.data.invites.length > 0 && (
        <div className="mt-2">
          <div className="muted tiny">Invitations en attente</div>
          {invites.data.invites.map((iv) => <Invite key={iv.id} tripId={tripId} invite={iv} onRevoked={reload} />)}
        </div>
      )}

      <div className="mt-3">
        <Field label="Inviter un co-enseignant par e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button
          disabled={!email.trim()}
          onClick={async () => {
            setMsg(""); setErr("");
            try {
              const r = await api.invite(tripId, email.trim());
              setMsg(`Invitation envoyée à ${r.invited}.`);
              setEmail(""); reload();
            } catch (e: any) {
              const code = e instanceof HttpError ? e.code : null;
              setErr(code === "already_member" ? "Déjà enseignant sur cette sortie."
                : code === "forbidden" ? "Seul le responsable de la sortie peut inviter des co-enseignants."
                : errorText(e, "Impossible d'envoyer l'invitation."));
            }
          }}
        >Envoyer l'invitation</Button>
        <Notice tone="ok">{msg}</Notice>
        <Notice tone="err">{err}</Notice>
      </div>
    </Card>
  );
}

function Invite({ tripId, invite, onRevoked }: { tripId: string; invite: { id: string; email: string }; onRevoked: () => void }) {
  const revoke = useAction(async () => { await api.revokeInvite(tripId, invite.id); onRevoked(); }, "Impossible de révoquer l'invitation.");
  return (
    <div className="people-row">
      <div className="row">
        <span className="grow">{invite.email}</span>
        <Button variant="neutral" size="mini" busy={revoke.busy} onClick={revoke.run}>Révoquer</Button>
      </div>
      <Notice tone="err">{revoke.error}</Notice>
    </div>
  );
}
