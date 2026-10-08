// Review: pending nominations — approve/reject, or remove any photo.
import { api } from "../../api.js";
import { Button, Card, Pill, useLightbox } from "../../ui.js";
import { useTrip } from "./TripLayout.js";

export function TripReview() {
  const { pending, reloadPending } = useTrip();
  const noms = { data: { nominations: pending }, reload: reloadPending };
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
