// Review: nominations waiting for a decision, grouped by challenge, then the approved ones.
// Any photo can be removed at any time — the child-safety backstop (CONTEXT: Moderation).
import { api, type NominationRow } from "../../api.js";
import { Button, EmptyState, Notice, Pill, useAction, useAsync, useConfirm, useLightbox } from "../../ui.js";
import { useTrip } from "./TripLayout.js";

export function TripReview() {
  const { tripId, pending, reloadPending } = useTrip();
  const challenges = useAsync(() => api.listChallenges(tripId).catch(() => ({ challenges: [] })), [tripId]);
  const approved = useAsync(
    () => api.listNominations(tripId, "approved").catch(() => ({ nominations: [] as NominationRow[] })),
    [tripId],
  );
  const titleOf = (id: string) => challenges.data?.challenges.find((c) => c.id === id)?.title ?? "Challenge";
  const changed = () => { reloadPending(); approved.reload(); };
  const votable = approved.data?.nominations ?? [];

  return (
    <>
      <section className="card" aria-labelledby="review-queue">
        <div className="row">
          <h3 id="review-queue" className="grow">Waiting for review</h3>
          {pending.length > 0 && <Pill tone="warn">{pending.length} waiting</Pill>}
        </div>
        {pending.length === 0
          ? <EmptyState icon="✅" title="Nothing to review" />
          : <Groups noms={pending} titleOf={titleOf} decide onChange={changed} />}
        <p className="muted tiny mb-0">
          Only approved nominations become votable. You can remove <b>any</b> photo, anytime.
        </p>
      </section>

      {votable.length > 0 && (
        <section className="card" aria-labelledby="review-approved">
          <h3 id="review-approved">Approved — votable</h3>
          <Groups noms={votable} titleOf={titleOf} onChange={changed} />
        </section>
      )}
    </>
  );
}

function Groups({
  noms, titleOf, decide, onChange,
}: { noms: NominationRow[]; titleOf: (id: string) => string; decide?: boolean; onChange: () => void }) {
  const byChallenge = new Map<string, NominationRow[]>();
  for (const n of noms) byChallenge.set(n.challenge_id, [...(byChallenge.get(n.challenge_id) ?? []), n]);
  return (
    <div className="stack mt-3">
      {[...byChallenge].map(([challengeId, list]) => {
        const title = titleOf(challengeId);
        const headingId = `review-${decide ? "q" : "a"}-${challengeId}`;
        return (
          <div key={challengeId} role="group" aria-labelledby={headingId}>
            <h4 id={headingId} className="review-h">{title}</h4>
            <div className="review-grid">
              {list.map((n) => <Nomination key={n.id} n={n} title={title} decide={decide} onChange={onChange} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One photo: enlarge, approve/reject (when deciding), or remove for good. */
function Nomination({
  n, title, decide, onChange,
}: { n: NominationRow; title: string; decide?: boolean; onChange: () => void }) {
  const openLightbox = useLightbox();
  const confirm = useConfirm();
  const approve = useAction(async () => { await api.moderate(n.id, "approve"); onChange(); }, "Could not approve.");
  const reject = useAction(async () => { await api.moderate(n.id, "reject"); onChange(); }, "Could not reject.");
  const remove = useAction(async () => {
    const ok = await confirm({
      title: "Remove this photo?",
      body: "No one will see it again — not the team, not the voters. Use this for anything inappropriate.",
      confirmLabel: "Remove photo", danger: true,
    });
    if (!ok) return;
    await api.removeSubmission(n.submission_id);
    onChange();
  }, "Could not remove the photo.");
  const busy = approve.busy || reject.busy || remove.busy;
  const src = api.photoUrl(n.submission_id);

  return (
    <div className="review-item">
      <button
        type="button" className="photo-btn" aria-label="Enlarge photo"
        onClick={() => openLightbox({ src, title, subtitle: decide ? "Waiting for review" : "Approved" })}
      >
        <img src={src} alt="" className="photo" loading="lazy" />
      </button>
      {decide && (
        <div className="review-acts">
          <Button variant="good" busy={approve.busy} disabled={busy} onClick={approve.run}>Approve</Button>
          <Button variant="crit" busy={reject.busy} disabled={busy} onClick={reject.run}>Reject</Button>
        </div>
      )}
      <Button variant="neutral" size="mini" busy={remove.busy} disabled={busy} onClick={remove.run}>Remove photo…</Button>
      <Notice tone="err">{approve.error || reject.error || remove.error}</Notice>
    </div>
  );
}
