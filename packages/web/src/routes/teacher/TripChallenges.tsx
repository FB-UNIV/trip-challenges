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
          <h3 className="grow">Défis</h3>
          {challenges.length > 0 && (
            <Link to={`/qr/${tripId}`} target="_blank" rel="noopener" className="btn btn-ghost btn-mini">Imprimer les QR codes</Link>
          )}
        </div>
        {list.loading && !list.data ? <Skeleton />
          : challenges.length === 0 ? <EmptyState icon="📸" title="Pas encore de défi" />
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
  }, "Impossible d'ajouter le défi.");
  return (
    <Card>
      <h3>Nouveau défi</h3>
      <ChallengeFields draft={draft} onChange={setDraft} />
      <Button disabled={!draft.title.trim()} busy={add.busy} onClick={add.run}>Ajouter le défi</Button>
      <Notice tone="err">{add.error}</Notice>
    </Card>
  );
}

function ChallengeFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => onChange({ ...draft, [k]: e.target.value });
  return (
    <>
      <Field label="Titre" value={draft.title} onChange={set("title")} />
      <label className="field">
        <span>Consignes</span>
        <textarea rows={3} value={draft.instructions} onChange={set("instructions")} />
      </label>
      <Field label="Multiplicateur de points — ×2 pour un défi boss" type="number" min={1} value={draft.multiplier} onChange={set("multiplier")} />
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
  }, "Impossible d'enregistrer le défi.");
  const remove = useAction(async () => {
    const ok = await confirm({ title: `Supprimer « ${c.title} » ?`, body: "Son QR code ne fonctionnera plus.", confirmLabel: "Supprimer", danger: true });
    if (!ok) return;
    await api.deleteChallenge(c.id);
    onChange();
  }, "Impossible de supprimer le défi.");

  if (editing) {
    return (
      <div className="challenge-edit">
        <ChallengeFields draft={draft} onChange={setDraft} />
        <div className="row">
          <Button disabled={!draft.title.trim()} busy={save.busy} onClick={save.run}>Enregistrer</Button>
          <Button variant="neutral" onClick={() => setEditing(false)}>Annuler</Button>
        </div>
        <Notice tone="err">{save.error}</Notice>
      </div>
    );
  }

  return (
    <div className="list-row challenge-row">
      <img src={api.qrUrl(c.id)} alt={`QR code du défi ${c.title}`} className="qr-img" />
      <div className="grow">
        <b>{c.title}</b> {Number(c.multiplier) !== 1 && <Pill tone="gold">×{c.multiplier}</Pill>}
        {c.instructions && <div className="d">{c.instructions}</div>}
        <Notice tone="err">{remove.error}</Notice>
      </div>
      <div className="challenge-acts">
        {canEdit && <Button variant="neutral" size="mini" onClick={() => setEditing(true)}>Modifier</Button>}
        {canDelete && <Button variant="danger" size="mini" busy={remove.busy} onClick={remove.run}>Supprimer</Button>}
      </div>
    </div>
  );
}
