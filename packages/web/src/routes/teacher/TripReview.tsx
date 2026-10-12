// Review: nominations waiting for a decision, grouped by challenge, then the approved ones.
// Any photo can be removed at any time — the child-safety backstop (CONTEXT: Moderation).
import { useState } from "react";
import { api, HttpError, type NominationRow } from "../../api.js";
import { qk, useLoad, useOptimistic } from "../../query.js";
import { Button, EmptyState, ErrorCard, Notice, Pill, useAction, useConfirm, useLightbox } from "../../ui.js";
import { rankOf, useTrip } from "./TripLayout.js";

export function TripReview() {
  const { tripId, pending, reloadPending, pendingError } = useTrip();
  const challenges = useLoad(qk.tripPart(tripId, "challenges"), () => api.listChallenges(tripId)); // titles only
  const approved = useLoad(
    qk.tripPart(tripId, "nominations", "approved"),
    () => api.listNominations(tripId, "approved"),
    { live: true },
  );
  const titleOf = (id: string) => challenges.data?.challenges.find((c) => c.id === id)?.title ?? "Défi";
  const changed = () => void reloadPending(); // the whole trip: queue, approved list, badge, overview
  // Kept here, not in each photo: an undone decision brings the photo back as a new element.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setError = (id: string, message: string) => setErrors((e) => ({ ...e, [id]: message }));
  const votable = approved.data?.nominations ?? [];

  return (
    <>
      <section className="card" aria-labelledby="review-queue">
        <div className="row">
          <h3 id="review-queue" className="grow">En attente de modération</h3>
          {pending.length > 0 && <Pill tone="warn">{pending.length} en attente</Pill>}
        </div>
        {pendingError ? <ErrorCard inline error={pendingError} onRetry={changed} />
          : pending.length === 0
          ? <EmptyState icon="✅" title="Rien à modérer" />
          : <Groups noms={pending} titleOf={titleOf} decide onChange={changed} errors={errors} setError={setError} />}
        <p className="muted tiny mb-0">
          Seules les photos validées sont soumises au vote. Tu peux retirer <b>n'importe quelle</b> photo, à tout moment.
        </p>
      </section>

      {approved.error && !approved.data && (
        <section className="card" aria-labelledby="review-approved">
          <h3 id="review-approved">Validées — ouvertes au vote</h3>
          <ErrorCard inline error={approved.error} onRetry={approved.reload} />
        </section>
      )}
      {votable.length > 0 && (
        <section className="card" aria-labelledby="review-approved">
          <h3 id="review-approved">Validées — ouvertes au vote</h3>
          <Groups noms={votable} titleOf={titleOf} onChange={changed} errors={errors} setError={setError} />
        </section>
      )}
    </>
  );
}

type Errors = { errors: Record<string, string>; setError: (id: string, message: string) => void };

function Groups({
  noms, titleOf, decide, onChange, errors, setError,
}: { noms: NominationRow[]; titleOf: (id: string) => string; decide?: boolean; onChange: () => void } & Errors) {
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
              {list.map((n) => (
                <Nomination key={n.id} n={n} title={title} decide={decide} onChange={onChange} error={errors[n.id]} setError={setError} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One photo: enlarge, approve/reject (when deciding), or remove for good. */
function Nomination({
  n, title, decide, onChange, error, setError,
}: { n: NominationRow; title: string; decide?: boolean; onChange: () => void; error?: string; setError: Errors["setError"] }) {
  const { tripId, trip } = useTrip();
  const openLightbox = useLightbox();
  const confirm = useConfirm();
  const optimistic = useOptimistic();
  // Optimistic: the photo leaves the queue (and the badge) at once; back with the reason if refused.
  const decideAs = (decision: "approve" | "reject") => async () => {
    // Once voting opened the team can't nominate another photo: say so first (#81, owner decision).
    if (decision === "reject" && rankOf(trip.phase) >= rankOf("voting")) {
      const ok = await confirm({
        title: "Refuser cette photo ?",
        body: "Le vote a commencé : cette équipe ne peut plus sélectionner d'autre photo et sort du vote pour ce défi.",
        confirmLabel: "Refuser", danger: true,
      });
      if (!ok) return;
    }
    setError(n.id, "");
    try {
      await optimistic<{ nominations: NominationRow[] }>(
        qk.tripPart(tripId, "nominations", "pending"),
        (old) => ({ nominations: old.nominations.filter((x) => x.id !== n.id) }),
        () => api.moderate(n.id, decision),
      );
      onChange();
    } catch (e) {
      setError(n.id, e instanceof HttpError ? e.reason : decision === "approve" ? "Impossible de valider." : "Impossible de refuser.");
    }
  };
  const remove = useAction(async () => {
    const ok = await confirm({
      title: "Retirer cette photo ?",
      body: "Plus personne ne la verra — ni l'équipe, ni les votants. À utiliser pour tout contenu inapproprié.",
      confirmLabel: "Retirer la photo", danger: true,
    });
    if (!ok) return;
    await api.removeSubmission(n.submission_id);
    onChange();
  }, "Impossible de retirer la photo.");
  const busy = remove.busy;
  const src = api.photoUrl(n.submission_id);

  return (
    <div className="review-item">
      <button
        type="button" className="photo-btn" aria-label="Agrandir la photo"
        onClick={() => openLightbox({ src, title, subtitle: decide ? "En attente de modération" : "Validée" })}
      >
        <img src={src} alt="" className="photo" loading="lazy" />
      </button>
      {decide && (
        <div className="review-acts">
          <Button variant="good" disabled={busy} onClick={decideAs("approve")}>Valider</Button>
          <Button variant="crit" disabled={busy} onClick={decideAs("reject")}>Refuser</Button>
        </div>
      )}
      <Button variant="neutral" size="mini" busy={remove.busy} disabled={busy} onClick={remove.run}>Retirer la photo…</Button>
      <Notice tone="err">{error || remove.error}</Notice>
    </div>
  );
}
