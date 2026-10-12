// Students: who has joined, whose code never arrived, who is in which team (#95, ADR 0006),
// then the teams with their names to check (ADR 0007), then roster import + recovery link.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { RosterEntry, TripTeam } from "@trip/shared";
import { api } from "../../api.js";
import {
  Button, Card, CopyField, EmptyState, ErrorCard, Notice, Pill, Progress, Skeleton, useAction, type Tone,
} from "../../ui.js";
import { qk, useLoad } from "../../query.js";
import { rankOf, useTrip } from "./TripLayout.js";

export function TripStudents() {
  const { tripId, trip, reload } = useTrip();
  // Live: students join and form teams from their phones while this is open.
  const roster = useLoad(qk.tripPart(tripId, "students"), () => api.tripStudents(tripId), { live: true });
  const teams = useLoad(qk.tripPart(tripId, "teams"), () => api.tripTeams(tripId), { live: true });
  const teamName = (id: string | null) => (id && teams.data?.teams.find((t) => t.id === id)?.name) || null;
  const emailOf = (id: string) => roster.data?.students.find((s) => s.id === id)?.email ?? "—";
  return (
    <>
      <Students tripId={tripId} data={roster.data} teamName={teamName} onChange={reload} />
      <Teams
        tripId={tripId} data={teams.data} emailOf={emailOf} onChange={reload}
        error={teams.error && !teams.data ? teams.error : null} onRetry={teams.reload}
        editable={rankOf(trip.phase) < rankOf("reveal")}
      />
      <Roster tripId={tripId} onSettled={reload} />
    </>
  );
}

// ---------- the student list ----------
const FILTERS = [
  { key: "all", label: "Tous", count: "all", test: () => true },
  { key: "not-joined", label: "Pas inscrits", count: "notJoined", test: (s: RosterEntry) => s.status !== "joined" },
  { key: "undelivered", label: "Non distribués", count: "undelivered", test: (s: RosterEntry) => s.status === "undelivered" },
  { key: "no-team", label: "Sans équipe", count: "noTeam", test: (s: RosterEntry) => s.kind === "student" && !s.teamId },
] as const;
const STATUS: Record<RosterEntry["status"], { label: string; tone: Tone }> = {
  joined: { label: "Inscrit", tone: "good" },
  invited: { label: "Invité", tone: "neutral" },
  undelivered: { label: "Non distribué", tone: "crit" },
  sending: { label: "Envoi", tone: "sky" },
};

function Students({
  tripId, data, teamName, onChange,
}: {
  tripId: string; data: Awaited<ReturnType<typeof api.tripStudents>> | null;
  teamName: (id: string | null) => string | null; onChange: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const filter = FILTERS.find((f) => f.key === params.get("filter")) ?? FILTERS[0];
  const pick = (key: string) => setParams(key === "all" ? {} : { filter: key }, { replace: true });
  const shown = (data?.students ?? [])
    .filter(filter.test)
    .filter((s) => s.email.includes(query.trim().toLowerCase()));

  return (
    <Card>
      <h3>Élèves</h3>
      {!data ? <Skeleton /> : (
        <>
          <div className="chips mt-2" role="group" aria-label="Filtrer les élèves">
            {FILTERS.map((f) => (
              <button
                key={f.key} type="button" className="chip" aria-pressed={f === filter}
                onClick={() => pick(f.key)}
              >{f.label} <span className="chip-n">{data.counts[f.count]}</span></button>
            ))}
          </div>
          <input
            type="search" className="input mt-2" placeholder="Rechercher par e-mail" aria-label="Rechercher par e-mail"
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
          {shown.length === 0
            ? <EmptyState icon="🔍" title={data.counts.all === 0 ? "Pas encore d'élèves — importe la liste ci-dessous" : "Personne ici"} />
            : (
              <ul className="roster-list" aria-label="Élèves">
                {shown.map((s) => <StudentRow key={s.id} tripId={tripId} s={s} team={teamName(s.teamId)} onChange={onChange} />)}
              </ul>
            )}
        </>
      )}
    </Card>
  );
}

function StudentRow({ tripId, s, team, onChange }: { tripId: string; s: RosterEntry; team: string | null; onChange: () => void }) {
  const [fixing, setFixing] = useState(false);
  const [email, setEmail] = useState(s.email);
  const [sentNote, setSentNote] = useState("");
  const resend = useAction(async () => {
    setSentNote("");
    await api.resendCode(tripId, s.id);
    setSentNote("Code envoyé.");
    onChange();
  }, "Impossible de renvoyer le code.");
  const fix = useAction(async () => {
    if (s.kind === "student") await api.fixAddress(tripId, s.id, email.trim());
    else await api.retryRosterItem(tripId, s.id, email.trim());
    setFixing(false);
    onChange();
  }, "Impossible de corriger l'adresse.");
  const st = STATUS[s.status];

  return (
    <li className="roster-row">
      <div className="roster-main">
        <Pill tone={st.tone} dot>{st.label}</Pill>
        <span className="grow">
          <b className="roster-email">{s.email}</b>
          <span className="d">
            {s.kind === "student" ? (team ?? "sans équipe") : "pas encore dans la sortie"}
            {s.newCodeRequested && " · nouveau code demandé"}
          </span>
        </span>
        <span className="roster-acts">
          {s.kind === "student" && (s.status === "invited" || s.status === "undelivered") && (
            <Button variant="neutral" size="mini" busy={resend.busy} onClick={resend.run}>Renvoyer le code</Button>
          )}
          {s.status === "undelivered" && !fixing && (
            <Button variant="soft" size="mini" onClick={() => { setEmail(s.email); setFixing(true); }}>Corriger l'adresse</Button>
          )}
        </span>
      </div>
      {fixing && (
        <div className="roster-fix">
          <input
            type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)}
            aria-label={`Adresse corrigée pour ${s.email}`} autoComplete="off"
          />
          <Button size="mini" disabled={!email.trim()} busy={fix.busy} onClick={fix.run}>Enregistrer et envoyer</Button>
          <Button variant="neutral" size="mini" onClick={() => setFixing(false)}>Annuler</Button>
        </div>
      )}
      <Notice tone="ok">{sentNote}</Notice>
      <Notice tone="err">{resend.error || fix.error}</Notice>
    </li>
  );
}

// ---------- teams, with their names to check before they can outlive the trip ----------
function Teams({
  tripId, data, emailOf, onChange, editable, error, onRetry,
}: {
  tripId: string; data: Awaited<ReturnType<typeof api.tripTeams>> | null; emailOf: (id: string) => string;
  onChange: () => void; editable: boolean; error: unknown; onRetry: () => void;
}) {
  const teams = data?.teams ?? [];
  return (
    <Card>
      <div className="row">
        <h3 className="grow">Équipes</h3>
        {data && <Pill>{teams.length}</Pill>}
      </div>
      <p className="muted tiny mt-0">
        {editable
          ? <>Les noms d'équipe ne sont conservés après la sortie que si tu les as vérifiés. Les noms non vérifiés deviennent « Équipe 1 », « Équipe 2 »… à l'effacement des données de la sortie.</>
          : <>Les noms sont définitifs : les résultats ont été calculés. Les noms non vérifiés deviennent « Équipe N » à l'effacement des données de la sortie.</>}
      </p>
      {error ? <ErrorCard inline error={error} onRetry={onRetry} />
        : !data ? <Skeleton /> : teams.length === 0 ? <EmptyState icon="🧑‍🤝‍🧑" title="Pas encore d'équipe" /> : (
        <div className="team-grid">
          {teams.map((t) => (
            <TeamCard key={t.id} tripId={tripId} t={t} max={data.maxTeamSize} emailOf={emailOf} editable={editable} onChange={onChange} />
          ))}
        </div>
      )}
    </Card>
  );
}

function TeamCard({
  tripId, t, max, emailOf, editable, onChange,
}: { tripId: string; t: TripTeam; max: number; emailOf: (id: string) => string; editable: boolean; onChange: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(t.name);
  const review = useAction(async () => { await api.reviewTeam(tripId, t.id); onChange(); }, "Impossible de valider le nom.");
  const rename = useAction(async () => {
    await api.renameTeam(tripId, t.id, name.trim());
    setRenaming(false);
    onChange();
  }, "Impossible de renommer l'équipe.");
  const headingId = `team-${t.id}`;
  return (
    <article className="team-card" aria-labelledby={headingId}>
      <div className="row">
        <h4 id={headingId} className="grow">{t.name}</h4>
        <Pill tone={t.nameReviewed ? "good" : "warn"} dot>{t.nameReviewed ? "Vérifié" : "Non vérifié"}</Pill>
      </div>
      <p className="d mt-0 mb-0">
        {t.members.length}/{max} · {t.photos} {t.photos <= 1 ? "photo" : "photos"} · {t.challengesEntered} {t.challengesEntered <= 1 ? "défi" : "défis"}
        {!t.nameReviewed && <> · s'affichera « {t.label} » après l'effacement</>}
      </p>
      {t.members.length > 0 && <ul className="team-members">{t.members.map((m) => <li key={m}>{emailOf(m)}</li>)}</ul>}
      {editable && !renaming && (
        <div className="row mt-2">
          {!t.nameReviewed && <Button variant="good" size="mini" busy={review.busy} onClick={review.run}>Nom OK</Button>}
          <Button variant="neutral" size="mini" onClick={() => { setName(t.name); setRenaming(true); }}>Renommer</Button>
        </div>
      )}
      {renaming && (
        <div className="roster-fix">
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label={`Nouveau nom pour ${t.name}`} />
          <Button size="mini" disabled={!name.trim()} busy={rename.busy} onClick={rename.run}>Enregistrer le nom</Button>
          <Button variant="neutral" size="mini" onClick={() => setRenaming(false)}>Annuler</Button>
        </div>
      )}
      <Notice tone="err">{review.error || rename.error}</Notice>
    </article>
  );
}

// ---------- import + recovery link ----------
function Roster({ tripId, onSettled }: { tripId: string; onSettled: () => void }) {
  const [text, setText] = useState("");
  const [queued, setQueued] = useState("");
  const [status, setStatus] = useState<{ pending: number; done: number; failed: number; students: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();

  // Poll progress while anything is still pending; stop when the queue drains.
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await api.rosterStatus(tripId);
        setStatus(s);
        if (s.pending === 0 && timer.current) { clearInterval(timer.current); timer.current = undefined; }
      } catch { /* ignore transient */ }
    };
    poll();
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [tripId]);

  const startPolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const s = await api.rosterStatus(tripId).catch(() => null);
      if (!s) return;
      setStatus(s);
      if (s.pending === 0 && timer.current) { clearInterval(timer.current); timer.current = undefined; onSettled(); }
    }, 2000);
  };

  const emails = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const importRoster = useAction(async () => {
    setQueued("");
    const r = await api.importRoster(tripId, emails);
    setQueued(`${r.queued} sur ${r.requested} en file d'attente. Envoi des codes d'accès en arrière-plan…`);
    setText("");
    onSettled(); // the new addresses show up as "sending"
    startPolling();
  }, "Impossible d'importer la liste.");
  const sent = status && status.students > 0 ? status : null;

  return (
    <Card>
      <h3>Liste d'élèves</h3>
      <label className="field">
        <span>E-mails des élèves — un par ligne ou séparés par des virgules</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      </label>
      <Button disabled={emails.length === 0} busy={importRoster.busy} onClick={importRoster.run}>Importer et envoyer les codes</Button>
      <Notice tone="ok">{queued}</Notice>
      <Notice tone="err">{importRoster.error}</Notice>
      {sent && (
        <div className="roster-progress">
          <Progress value={sent.done} max={sent.students} label="Codes envoyés" tone="good" />
          <p className="muted tiny mb-0">{sent.done} codes envoyés sur {sent.students}{sent.pending > 0 && " — envoi…"}</p>
          {sent.failed > 0 && (
            <p className="warncard tiny mb-0">
              <b>{sent.failed === 1 ? "1 e-mail en échec" : `${sent.failed} e-mails en échec`}</b> — vérifie {sent.failed === 1 ? "l'adresse et réimporte-la" : "les adresses et réimporte-les"}.
            </p>
          )}
        </div>
      )}
      <div className="mt-4">
        <CopyField label="Lien de récupération de code" value={`${location.origin}/join?trip=${tripId}`} />
        <p className="muted tiny mt-0">Partage-le avec tout élève qui a changé ou perdu son appareil.</p>
      </div>
    </Card>
  );
}
