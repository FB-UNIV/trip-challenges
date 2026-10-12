// Pairwise duel screen (ADR-0002): two photos, pick the better, repeat.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { DuelPair } from "@trip/shared";
import { api, errorText, HttpError } from "../api.js";
import { qk, useMyChallenges, useRefresh } from "../query.js";
import { Card, Celebrate, EmptyState, ErrorCard, Notice, Progress, Skeleton, useLightbox } from "../ui.js";
import { byVotingOrder, canVote } from "./vote-progress.js";

export function VotePage() {
  const { challengeId } = useParams();
  // Keyed so "Next challenge" starts the following challenge from a clean slate.
  return <Duels key={challengeId} challengeId={challengeId!} />;
}

function Duels({ challengeId }: { challengeId: string }) {
  const [pair, setPair] = useState<DuelPair | null>(null);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState<"not_enough" | "exhausted" | "closed" | undefined>();
  const [busy, setBusy] = useState(false);
  const [judged, setJudged] = useState(0);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [castError, setCastError] = useState("");
  // Progress is a nice-to-have: voting works without it.
  const list = useMyChallenges();
  const refresh = useRefresh();
  const openLightbox = useLightbox();

  const load = useCallback(async () => {
    setLoadError(null);
    let next;
    try { next = await api.nextDuel(challengeId); } catch (e) { setLoadError(e); return; }
    if (!next.pair) { setReason(next.reason); setDone(true); }
    else { setPair(next.pair); setDone(false); }
  }, [challengeId]);

  useEffect(() => { void load(); }, [load]);

  async function pick(winnerNominationId: string) {
    if (!pair || busy) return;
    setBusy(true); setCastError("");
    try {
      try {
        await api.castDuel({ pairToken: pair.pairToken, winnerNominationId });
        setJudged((n) => n + 1);
      } catch (e) {
        // The server (or the network) failed: keep this pair so the vote can be cast again (#69).
        if (!(e instanceof HttpError) || e.status === 0 || e.status === 429 || e.status >= 500) {
          setCastError(`Ton vote n'a pas été enregistré. ${errorText(e)}`);
          return;
        }
        // Refused (voting just closed, pair already cast…): the next load says what's going on.
      }
      setPair(null);
      void refresh(qk.myChallenges); // progress here, the Vote badge, the vote list
      await load();
    } finally {
      setBusy(false);
    }
  }

  const challenges = list.data?.challenges ?? [];
  if (done) {
    if (reason === "closed") {
      return <Card><EmptyState icon="🔒" title="Le vote est fermé"><Link to="/">Retour à l'accueil</Link></EmptyState></Card>;
    }
    if (reason === "not_enough") {
      return (
        <Card>
          <EmptyState icon="🖼️" title="En attente d'autres photos"><Link to="/vote">Retour aux défis</Link></EmptyState>
        </Card>
      );
    }
    const next = byVotingOrder(challenges).find((c) => c.id !== challengeId && canVote(c));
    return (
      <Card>
        {next ? (
          <Celebrate icon="✅" title="Défi terminé !">
            <Link to={`/vote/${next.id}`} className="btn btn-block" style={{ marginTop: 8 }}>Défi suivant → {next.title}</Link>
          </Celebrate>
        ) : (
          <Celebrate icon="🎉" title="Tout est voté !">
            <Link to="/vote" className="btn btn-ghost" style={{ marginTop: 8 }}>Retour aux défis</Link>
          </Celebrate>
        )}
      </Card>
    );
  }
  if (loadError) return <ErrorCard error={loadError} onRetry={() => void load()} />;
  if (!pair) return <Card><Skeleton lines={3} /></Card>;

  const vote = challenges.find((c) => c.id === challengeId)?.vote;
  const total = vote?.total ?? 0;
  const voted = Math.min((vote?.voted ?? 0) + judged, total);
  // Tapping a photo votes for it; the 🔍 (a sibling: buttons can't nest) only shows it full
  // screen, so a small phone photo can be judged before picking (#82).
  const side = (label: "A" | "B", nominationId: string, submissionId: string) => (
    <div className="duel-opt">
      <button className="pick" onClick={() => pick(nominationId)} disabled={busy} aria-label="Choisir cette photo">
        <img src={api.photoUrl(submissionId)} alt="choix" />
      </button>
      <button
        type="button" className="zoom" aria-label={`Voir la photo ${label} en plein écran`}
        onClick={() => openLightbox({ src: api.photoUrl(submissionId), title: `Photo ${label}` })}
      >🔍</button>
    </div>
  );

  return (
    <div>
      <div className="duel-head">
        <h2>Laquelle est la meilleure ?</h2>
        {total > 0 && (
          <>
            <div className="prog">{voted} / {total}</div>
            <Progress value={voted} max={total} label="Duels votés" tone="sky" />
          </>
        )}
      </div>
      <div className="duel">
        {side("A", pair.aNominationId, pair.aSubmissionId)}
        <span className="vs">VS</span>
        {side("B", pair.bNominationId, pair.bSubmissionId)}
      </div>
      <div className="duel-foot">Touche une photo · jamais celle de ton équipe</div>
      <Notice tone="err">{castError}</Notice>
    </div>
  );
}
