// Challenges: list with QR codes, add, edit and (in draft) delete.
import { useState } from "react";
import { api, type ChallengeSummary } from "../../api.js";
import { Button, Card, Field, useAsync, useConfirm } from "../../ui.js";
import { rankOf, useTrip } from "./TripLayout.js";

export function TripChallenges() {
  const { tripId, trip } = useTrip();
  return <Challenges tripId={tripId} phase={trip.phase} />;
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
  const confirm = useConfirm();
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
              const ok = await confirm({ title: `Delete “${c.title}”?`, body: "Its QR code will stop working.", confirmLabel: "Delete", danger: true });
              if (ok) { await api.deleteChallenge(c.id); onChange(); }
            }}
          >Delete</Button>
        )}
      </div>
    </div>
  );
}
