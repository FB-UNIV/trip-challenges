// Challenges: list with QR codes, add, edit and (in draft) delete; print the QR sheet.
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type ChallengeSummary } from "../../api.js";
import { qk, useLoad } from "../../query.js";
import { Button, Card, EmptyState, Field, Notice, Pill, Skeleton, useAction, useConfirm } from "../../ui.js";
import { rankOf, useTrip } from "./TripLayout.js";

type Draft = { title: string; instructions: string; multiplier: string };
const toInput = (d: Draft) => ({ title: d.title.trim(), instructions: d.instructions, multiplier: Number(d.multiplier) });

export function TripChallenges() {
  const { tripId, trip, reload } = useTrip();
  const list = useLoad(qk.tripPart(tripId, "challenges"), () => api.listChallenges(tripId));
  const canEdit = rankOf(trip.phase) < rankOf("reveal");
  const canAdd = rankOf(trip.phase) < rankOf("voting");
  const canDelete = trip.phase === "draft";
  const challenges = list.data?.challenges ?? [];

  return (
    <>
      <Card>
        <div className="row">
          <h3 className="grow">Challenges</h3>
          {challenges.length > 0 && (
            <Link to={`/qr/${tripId}`} target="_blank" rel="noopener" className="btn btn-ghost btn-mini">Print QR codes</Link>
          )}
        </div>
        {list.loading && !list.data ? <Skeleton />
          : challenges.length === 0 ? <EmptyState icon="📸" title="No challenges yet" />
          : challenges.map((c) => (
            <ChallengeRow key={c.id} c={c} canEdit={canEdit} canDelete={canDelete} onChange={reload} />
          ))}
      </Card>
      {canAdd && <NewChallenge tripId={tripId} onAdded={reload} />}
    </>
  );
}

const EMPTY: Draft = { title: "", instructions: "", multiplier: "1" };

function NewChallenge({ tripId, onAdded }: { tripId: string; onAdded: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const add = useAction(async () => {
    await api.createChallenge(tripId, toInput(draft));
    setDraft(EMPTY);
    onAdded();
  }, "Could not add the challenge.");
  return (
    <Card>
      <h3>New challenge</h3>
      <ChallengeFields draft={draft} onChange={setDraft} />
      <Button disabled={!draft.title.trim()} busy={add.busy} onClick={add.run}>Add challenge</Button>
      <Notice tone="err">{add.error}</Notice>
    </Card>
  );
}

function ChallengeFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => onChange({ ...draft, [k]: e.target.value });
  return (
    <>
      <Field label="Title" value={draft.title} onChange={set("title")} />
      <label className="field">
        <span>Instructions</span>
        <textarea rows={3} value={draft.instructions} onChange={set("instructions")} />
      </label>
      <Field label="Points multiplier — ×2 for a boss challenge" type="number" min={1} value={draft.multiplier} onChange={set("multiplier")} />
    </>
  );
}

function ChallengeRow({
  c, canEdit, canDelete, onChange,
}: { c: ChallengeSummary; canEdit: boolean; canDelete: boolean; onChange: () => void }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({ title: c.title, instructions: c.instructions, multiplier: String(c.multiplier) });
  const save = useAction(async () => {
    await api.updateChallenge(c.id, toInput(draft));
    setEditing(false);
    onChange();
  }, "Could not save the challenge.");
  const remove = useAction(async () => {
    const ok = await confirm({ title: `Delete “${c.title}”?`, body: "Its QR code will stop working.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    await api.deleteChallenge(c.id);
    onChange();
  }, "Could not delete the challenge.");

  if (editing) {
    return (
      <div className="challenge-edit">
        <ChallengeFields draft={draft} onChange={setDraft} />
        <div className="row">
          <Button disabled={!draft.title.trim()} busy={save.busy} onClick={save.run}>Save</Button>
          <Button variant="neutral" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
        <Notice tone="err">{save.error}</Notice>
      </div>
    );
  }

  return (
    <div className="list-row challenge-row">
      <img src={api.qrUrl(c.id)} alt={`QR code for ${c.title}`} className="qr-img" />
      <div className="grow">
        <b>{c.title}</b> {Number(c.multiplier) !== 1 && <Pill tone="gold">×{c.multiplier}</Pill>}
        {c.instructions && <div className="d">{c.instructions}</div>}
        <Notice tone="err">{remove.error}</Notice>
      </div>
      <div className="challenge-acts">
        {canEdit && <Button variant="neutral" size="mini" onClick={() => setEditing(true)}>Edit</Button>}
        {canDelete && <Button variant="danger" size="mini" busy={remove.busy} onClick={remove.run}>Delete</Button>}
      </div>
    </div>
  );
}
