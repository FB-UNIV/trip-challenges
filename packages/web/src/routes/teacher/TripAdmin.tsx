import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, HttpError, type ChallengeSummary } from "../../api.js";
import { Button, Card, Field, PhasePill, PhaseTrail, Pill, useAsync, useLightbox } from "../../ui.js";

const NEXT: Record<string, string> = { draft: "challenge", challenge: "voting", voting: "reveal", reveal: "grace" };
const PHASES = ["draft", "challenge", "voting", "reveal", "grace", "erased"];
const rankOf = (p: string) => PHASES.indexOf(p);

export function TripAdmin() {
  const { id } = useParams();
  const trip = useAsync(() => api.getTrip(id!), [id]);
  // Only the first load blanks the page: a reload after a save must keep the cards
  // mounted, or their confirmations ("Saved.") vanish before anyone sees them (#30).
  if (trip.loading && !trip.data) return <p className="muted">Loading…</p>;
  const t = trip.data;
  if (!t) return <p className="err">Not found.</p>;

  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ flex: 1 }}>{t.name}</h2>
        <PhasePill phase={t.phase} dot />
      </div>
      <div style={{ padding: "2px 2px 0" }}><PhaseTrail phase={t.phase} variant="teacher" /></div>
      <Tiles key={`tiles-${t.phase}`} tripId={id!} phase={t.phase} />
      <PhaseControl tripId={id!} phase={t.phase} onChange={trip.reload} />
      {/* Remount on a phase change so phase-dependent lists (moderation, tiles) refetch. */}
      <div className="admin-grid" key={`grid-${t.phase}`}>
        <Settings tripId={id!} trip={t} onSaved={trip.reload} />
        <CoTeachers tripId={id!} />
        <Roster tripId={id!} />
        <Challenges tripId={id!} phase={t.phase} />
        <Moderation tripId={id!} />
        <Results tripId={id!} phase={t.phase} />
      </div>
    </div>
  );
}

function Tiles({ tripId, phase }: { tripId: string; phase: string }) {
  const roster = useAsync(() => api.rosterStatus(tripId).catch(() => null), [tripId]);
  const ch = useAsync(() => api.listChallenges(tripId).catch(() => ({ challenges: [] })), [tripId]);
  const noms = useAsync(() => api.listNominations(tripId, "pending").catch(() => ({ nominations: [] })), [tripId]);
  const pending = noms.data?.nominations.length ?? 0;
  return (
    <div className="tiles">
      <div className="tile"><div className="k">Phase</div><div className="v" style={{ fontSize: 18 }}>{phase}</div></div>
      <div className="tile"><div className="k">Students</div><div className="v">{roster.data?.students ?? "—"}</div></div>
      <div className="tile"><div className="k">Codes emailed</div><div className="v">{roster.data?.done ?? "—"}</div></div>
      <div className="tile"><div className="k">Challenges</div><div className="v">{ch.data?.challenges.length ?? "—"}</div></div>
      <div className={pending > 0 ? "tile flag" : "tile"}><div className="k">Pending review</div><div className="v">{pending}</div></div>
    </div>
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

function PhaseControl({ tripId, phase, onChange }: { tripId: string; phase: string; onChange: () => void }) {
  const next = NEXT[phase];
  return (
    <Card>
      <div className="row">
        <h3 style={{ flex: 1 }}>Lifecycle</h3>
        <PhasePill phase={phase} dot />
      </div>
      <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
        {next && (
          <Button
            onClick={async () => {
              // Refused = the trip already moved on (a co-teacher, or its planned date): either way, catch up.
              try { await api.advance(tripId, next); } catch { /* the reload shows where it is now */ }
              onChange();
            }}
          >Advance to {next} →</Button>
        )}
        <Button
          variant="danger"
          onClick={async () => {
            if (confirm("Permanently erase ALL student data for this trip? This cannot be undone.")) {
              await api.erase(tripId); onChange();
            }
          }}
        >Erase now</Button>
      </div>
    </Card>
  );
}

function Roster({ tripId }: { tripId: string }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
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
      if (s.pending === 0 && timer.current) { clearInterval(timer.current); timer.current = undefined; }
    }, 2000);
  };

  return (
    <Card>
      <h3>Roster</h3>
      <p className="muted tiny" style={{ margin: "4px 0 8px" }}>Paste student emails (one per line or comma-separated).</p>
      <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      <div style={{ marginTop: 8 }}>
        <Button
          onClick={async () => {
            const emails = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
            if (!emails.length) return;
            setMsg(""); setErr("");
            try {
              const r = await api.importRoster(tripId, emails);
              setMsg(`Queued ${r.queued} of ${r.requested}. Sending access codes in the background…`);
              setText("");
              startPolling();
            } catch (e) {
              setErr(`Could not import${e instanceof HttpError ? `: ${e.reason}` : "."}`);
            }
          }}
        >Import + email codes</Button>
      </div>
      {msg && <p className="ok tiny">{msg}</p>}
      {err && <p className="err tiny">{err}</p>}
      {status && (status.pending > 0 || status.done > 0 || status.failed > 0) && (
        <p className="muted tiny">
          {status.students} students · {status.pending} queued
          {status.done > 0 && ` · ${status.done} emailed`}
          {status.failed > 0 && ` · ${status.failed} failed`}
        </p>
      )}
      <p className="muted tiny" style={{ marginTop: 12 }}>
        Lost-code recovery link — share with any student who changed or lost their device:
        <code className="codebox">{`${location.origin}/join?trip=${tripId}`}</code>
      </p>
    </Card>
  );
}

function Challenges({ tripId, phase }: { tripId: string; phase: string }) {
  const list = useAsync(() => api.listChallenges(tripId), [tripId]);
  const canEdit = rankOf(phase) < rankOf("reveal");
  const canAdd = rankOf(phase) < rankOf("voting");
  const canDelete = phase === "draft";
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mult, setMult] = useState("1");
  return (
    <Card>
      <h3>Challenges</h3>
      {list.data?.challenges.map((c) => (
        <ChallengeRow key={c.id} c={c} canEdit={canEdit} canDelete={canDelete} onChange={list.reload} />
      ))}
      {canAdd && (
        <div style={{ marginTop: 12 }}>
          <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Field label="Instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <Field label="Multiplier" type="number" value={mult} onChange={(e) => setMult(e.target.value)} />
          <Button
            disabled={!title.trim()}
            onClick={async () => {
              await api.createChallenge(tripId, { title: title.trim(), instructions, multiplier: Number(mult) });
              setTitle(""); setInstructions(""); setMult("1");
              list.reload();
            }}
          >Add challenge</Button>
        </div>
      )}
    </Card>
  );
}

function ChallengeRow({
  c, canEdit, canDelete, onChange,
}: { c: ChallengeSummary; canEdit: boolean; canDelete: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);
  const [instructions, setInstructions] = useState(c.instructions);
  const [mult, setMult] = useState(String(c.multiplier));

  if (editing) {
    return (
      <div style={{ padding: "8px 0", borderTop: "1px solid var(--line-2)" }}>
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Field label="Instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        <Field label="Multiplier" type="number" value={mult} onChange={(e) => setMult(e.target.value)} />
        <div className="row">
          <Button
            disabled={!title.trim()}
            onClick={async () => {
              await api.updateChallenge(c.id, { title: title.trim(), instructions, multiplier: Number(mult) });
              setEditing(false); onChange();
            }}
          >Save</Button>
          <Button variant="neutral" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="list-row">
      <img src={api.qrUrl(c.id)} alt="QR" className="qr-img" />
      <div className="grow">
        <b>{c.title}</b> {c.multiplier !== 1 && <span className="pill pill-gold">×{c.multiplier}</span>}
        <div className="d">{c.instructions}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {canEdit && <Button size="mini" onClick={() => setEditing(true)}>Edit</Button>}
        {canDelete && (
          <Button
            variant="danger" size="mini"
            onClick={async () => {
              if (confirm(`Delete "${c.title}"? Its QR code will stop working.`)) { await api.deleteChallenge(c.id); onChange(); }
            }}
          >Delete</Button>
        )}
      </div>
    </div>
  );
}

function Moderation({ tripId }: { tripId: string }) {
  const noms = useAsync(() => api.listNominations(tripId, "pending"), [tripId]);
  const openLightbox = useLightbox();
  return (
    <Card>
      <div className="row">
        <h3 style={{ flex: 1 }}>Moderation</h3>
        {(noms.data?.nominations.length ?? 0) > 0 && <Pill tone="warn">{noms.data!.nominations.length} pending</Pill>}
      </div>
      {noms.data?.nominations.length === 0 && <p className="muted" style={{ marginBottom: 0 }}>Nothing to review.</p>}
      <div className="mod-grid" style={{ marginTop: 10 }}>
        {noms.data?.nominations.map((n) => (
          <div key={n.id} className="mod-cell">
            <img
              src={api.photoUrl(n.submission_id)} alt="" className="photo zoom" style={{ aspectRatio: "1" }}
              onClick={() => openLightbox({ src: api.photoUrl(n.submission_id), title: "Nomination", subtitle: "Pending review", frame: "#9fb3b3" })}
            />
            <div className="acts">
              <Button variant="soft" size="mini" style={{ background: "var(--good-wash)", color: "var(--good)" }}
                onClick={async () => { await api.moderate(n.id, "approve"); noms.reload(); }}>Approve</Button>
              <Button variant="soft" size="mini" style={{ background: "var(--crit-wash)", color: "var(--crit)" }}
                onClick={async () => { await api.moderate(n.id, "reject"); noms.reload(); }}>Reject</Button>
            </div>
            <Button variant="neutral" size="mini"
              onClick={async () => { await api.removeSubmission(n.submission_id); noms.reload(); }}>Remove photo</Button>
          </div>
        ))}
      </div>
      <p className="muted tiny" style={{ marginBottom: 0 }}>
        Only approved nominations become votable. You can remove <b>any</b> photo, anytime — the child-safety backstop.
      </p>
    </Card>
  );
}

function Results({ tripId, phase }: { tripId: string; phase: string }) {
  const res = useAsync(() => api.results(tripId).catch(() => ({ results: [] })), [tripId]);
  if (phase !== "reveal" && phase !== "grace" && phase !== "erased") return null;
  const results = res.data?.results ?? [];
  const champions = results.filter((r) => r.is_grand_champion);

  return (
    <Card>
      <h3>Results &amp; ceremony</h3>
      {phase === "reveal" && (
        <p className="muted tiny" style={{ marginTop: 4 }}>
          Results are hidden from students until you advance to <b>grace</b> — do that when the ceremony is done.
        </p>
      )}

      {/* Grand Champion tie — the teacher picks one (CONTEXT: Grand Champion). */}
      {phase === "reveal" && champions.length > 1 && (
        <div className="warncard" style={{ margin: "8px 0" }}>
          <b>It's a tie for Grand Champion — pick the winner:</b>
          {champions.map((c) => (
            <div key={c.id} className="row" style={{ marginTop: 6 }}>
              <span style={{ flex: 1 }}>{c.team_name_vetted} ({c.points} pts)</span>
              <Button size="mini" onClick={async () => { await api.setGrandChampion(tripId, c.id); res.reload(); }}>Crown this team</Button>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <Button
          variant="gold" style={{ marginBottom: 10 }}
          onClick={() => window.open(`/ceremony/${tripId}`, "_blank", "noopener")}
        >🏆 Launch ceremony</Button>
      )}
      {results.map((r) => (
        <div key={r.id} style={{ padding: "4px 0", fontWeight: r.is_grand_champion ? 700 : 400 }}>
          {r.is_grand_champion ? "🏆 " : `${r.challenge_title} #${r.placement} — `}
          {r.team_name_vetted} ({r.points} pts)
        </div>
      ))}
    </Card>
  );
}
