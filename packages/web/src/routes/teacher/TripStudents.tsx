// Students: who has joined, whose code never arrived, who is in which team (#95, ADR 0006),
// then the teams with their names to check (ADR 0007), then roster import + recovery link.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { RosterEntry, TripTeam } from "@trip/shared";
import { api } from "../../api.js";
import {
  Button, Card, CopyField, EmptyState, Notice, Pill, Progress, Skeleton, useAction, useAsync, type Tone,
} from "../../ui.js";
import { rankOf, useTrip } from "./TripLayout.js";

export function TripStudents() {
  const { tripId, trip } = useTrip();
  const roster = useAsync(() => api.tripStudents(tripId), [tripId]);
  const teams = useAsync(() => api.tripTeams(tripId).catch(() => null), [tripId]);
  const reload = () => { roster.reload(); teams.reload(); };
  const teamName = (id: string | null) => (id && teams.data?.teams.find((t) => t.id === id)?.name) || null;
  const emailOf = (id: string) => roster.data?.students.find((s) => s.id === id)?.email ?? "—";
  return (
    <>
      <Students tripId={tripId} data={roster.data} teamName={teamName} onChange={reload} />
      <Teams
        tripId={tripId} data={teams.data} emailOf={emailOf} onChange={teams.reload}
        editable={rankOf(trip.phase) < rankOf("reveal")}
      />
      <Roster tripId={tripId} onSettled={roster.reload} />
    </>
  );
}

// ---------- the student list ----------
const FILTERS = [
  { key: "all", label: "All", count: "all", test: () => true },
  { key: "not-joined", label: "Not joined", count: "notJoined", test: (s: RosterEntry) => s.status !== "joined" },
  { key: "undelivered", label: "Undelivered", count: "undelivered", test: (s: RosterEntry) => s.status === "undelivered" },
  { key: "no-team", label: "No team", count: "noTeam", test: (s: RosterEntry) => s.kind === "student" && !s.teamId },
] as const;
const STATUS: Record<RosterEntry["status"], { label: string; tone: Tone }> = {
  joined: { label: "Joined", tone: "good" },
  invited: { label: "Invited", tone: "neutral" },
  undelivered: { label: "Undelivered", tone: "crit" },
  sending: { label: "Sending", tone: "sky" },
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
      <h3>Students</h3>
      {!data ? <Skeleton /> : (
        <>
          <div className="chips mt-2" role="group" aria-label="Filter students">
            {FILTERS.map((f) => (
              <button
                key={f.key} type="button" className="chip" aria-pressed={f === filter}
                onClick={() => pick(f.key)}
              >{f.label} <span className="chip-n">{data.counts[f.count]}</span></button>
            ))}
          </div>
          <input
            type="search" className="input mt-2" placeholder="Search by email" aria-label="Search by email"
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
          {shown.length === 0
            ? <EmptyState icon="🔍" title={data.counts.all === 0 ? "No students yet — import the roster below" : "No one here"} />
            : (
              <ul className="roster-list" aria-label="Students">
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
    setSentNote("Code sent.");
    onChange();
  }, "Could not resend the code.");
  const fix = useAction(async () => {
    if (s.kind === "student") await api.fixAddress(tripId, s.id, email.trim());
    else await api.retryRosterItem(tripId, s.id, email.trim());
    setFixing(false);
    onChange();
  }, "Could not fix the address.");
  const st = STATUS[s.status];

  return (
    <li className="roster-row">
      <div className="roster-main">
        <Pill tone={st.tone} dot>{st.label}</Pill>
        <span className="grow">
          <b className="roster-email">{s.email}</b>
          <span className="d">
            {s.kind === "student" ? (team ?? "no team") : "not on the trip yet"}
            {s.newCodeRequested && " · new code requested"}
          </span>
        </span>
        <span className="roster-acts">
          {s.kind === "student" && (s.status === "invited" || s.status === "undelivered") && (
            <Button variant="neutral" size="mini" busy={resend.busy} onClick={resend.run}>Resend code</Button>
          )}
          {s.status === "undelivered" && !fixing && (
            <Button variant="soft" size="mini" onClick={() => { setEmail(s.email); setFixing(true); }}>Fix address</Button>
          )}
        </span>
      </div>
      {fixing && (
        <div className="roster-fix">
          <input
            type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)}
            aria-label={`Correct address for ${s.email}`} autoComplete="off"
          />
          <Button size="mini" disabled={!email.trim()} busy={fix.busy} onClick={fix.run}>Save &amp; send</Button>
          <Button variant="neutral" size="mini" onClick={() => setFixing(false)}>Cancel</Button>
        </div>
      )}
      <Notice tone="ok">{sentNote}</Notice>
      <Notice tone="err">{resend.error || fix.error}</Notice>
    </li>
  );
}

// ---------- teams, with their names to check before they can outlive the trip ----------
function Teams({
  tripId, data, emailOf, onChange, editable,
}: {
  tripId: string; data: Awaited<ReturnType<typeof api.tripTeams>> | null; emailOf: (id: string) => string;
  onChange: () => void; editable: boolean;
}) {
  const teams = data?.teams ?? [];
  return (
    <Card>
      <div className="row">
        <h3 className="grow">Teams</h3>
        {data && <Pill>{teams.length}</Pill>}
      </div>
      <p className="muted tiny mt-0">
        {editable
          ? <>Team names are kept after the trip only if you've checked them. Unchecked names become “Team 1”, “Team 2”… when the trip's data is erased.</>
          : <>Names are final: results have been computed. Unchecked names become their “Team N” label when the trip's data is erased.</>}
      </p>
      {!data ? <Skeleton /> : teams.length === 0 ? <EmptyState icon="🧑‍🤝‍🧑" title="No teams yet" /> : (
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
  const review = useAction(async () => { await api.reviewTeam(tripId, t.id); onChange(); }, "Could not mark the name.");
  const rename = useAction(async () => {
    await api.renameTeam(tripId, t.id, name.trim());
    setRenaming(false);
    onChange();
  }, "Could not rename the team.");
  const headingId = `team-${t.id}`;
  return (
    <article className="team-card" aria-labelledby={headingId}>
      <div className="row">
        <h4 id={headingId} className="grow">{t.name}</h4>
        <Pill tone={t.nameReviewed ? "good" : "warn"} dot>{t.nameReviewed ? "Checked" : "Not checked"}</Pill>
      </div>
      <p className="d mt-0 mb-0">
        {t.members.length}/{max} · {t.photos} {t.photos === 1 ? "photo" : "photos"} · {t.challengesEntered} {t.challengesEntered === 1 ? "challenge" : "challenges"}
        {!t.nameReviewed && <> · will show as “{t.label}” after erasure</>}
      </p>
      {t.members.length > 0 && <ul className="team-members">{t.members.map((m) => <li key={m}>{emailOf(m)}</li>)}</ul>}
      {editable && !renaming && (
        <div className="row mt-2">
          {!t.nameReviewed && <Button variant="good" size="mini" busy={review.busy} onClick={review.run}>Name OK</Button>}
          <Button variant="neutral" size="mini" onClick={() => { setName(t.name); setRenaming(true); }}>Rename</Button>
        </div>
      )}
      {renaming && (
        <div className="roster-fix">
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label={`New name for ${t.name}`} />
          <Button size="mini" disabled={!name.trim()} busy={rename.busy} onClick={rename.run}>Save name</Button>
          <Button variant="neutral" size="mini" onClick={() => setRenaming(false)}>Cancel</Button>
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
    setQueued(`Queued ${r.queued} of ${r.requested}. Sending access codes in the background…`);
    setText("");
    onSettled(); // the new addresses show up as "sending"
    startPolling();
  }, "Could not import the roster.");
  const sent = status && status.students > 0 ? status : null;

  return (
    <Card>
      <h3>Roster</h3>
      <label className="field">
        <span>Student emails — one per line or comma-separated</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      </label>
      <Button disabled={emails.length === 0} busy={importRoster.busy} onClick={importRoster.run}>Import + email codes</Button>
      <Notice tone="ok">{queued}</Notice>
      <Notice tone="err">{importRoster.error}</Notice>
      {sent && (
        <div className="roster-progress">
          <Progress value={sent.done} max={sent.students} label="Codes emailed" tone="good" />
          <p className="muted tiny mb-0">{sent.done} of {sent.students} codes emailed{sent.pending > 0 && " — sending…"}</p>
          {sent.failed > 0 && (
            <p className="warncard tiny mb-0">
              <b>{sent.failed === 1 ? "1 email failed" : `${sent.failed} emails failed`}</b> — check the address{sent.failed === 1 ? "" : "es"} and import {sent.failed === 1 ? "it" : "them"} again.
            </p>
          )}
        </div>
      )}
      <div className="mt-4">
        <CopyField label="Lost-code recovery link" value={`${location.origin}/join?trip=${tripId}`} />
        <p className="muted tiny mt-0">Share it with any student who changed or lost their device.</p>
      </div>
    </Card>
  );
}
