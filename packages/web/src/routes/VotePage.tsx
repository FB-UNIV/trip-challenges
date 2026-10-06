// Pairwise duel screen (ADR-0002): two photos, pick the better, repeat.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DuelPair } from "@trip/shared";
import { api } from "../api.js";
import { Card } from "../ui.js";

export function VotePage() {
  const { challengeId } = useParams();
  const [pair, setPair] = useState<DuelPair | null>(null);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState<"not_enough" | "exhausted" | "closed" | undefined>();
  const [busy, setBusy] = useState(false);
  const [judged, setJudged] = useState(0);

  const load = useCallback(async () => {
    if (!challengeId) return;
    const next = await api.nextDuel(challengeId);
    if (!next.pair) { setReason(next.reason); setDone(true); }
    else { setPair(next.pair); setDone(false); }
  }, [challengeId]);

  useEffect(() => { void load(); }, [load]);

  async function pick(winnerNominationId: string) {
    if (!pair || busy) return;
    setBusy(true);
    try {
      await api.castDuel({ pairToken: pair.pairToken, winnerNominationId });
      setJudged((n) => n + 1);
      setPair(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        {reason === "closed" ? (
          <p style={{ margin: 0 }}>
            Voting isn't open right now. Duels run during the voting period only. <Link to="/">Back home</Link>
          </p>
        ) : reason === "not_enough" ? (
          <p style={{ margin: 0 }}>
            Nothing to compare here yet. A duel needs <b>two approved photos from other teams</b>,
            so pairwise voting needs <b>3 or more teams</b> and the teacher to approve their
            nominations. Once that's set up, come back to vote. <Link to="/vote">Back</Link>
          </p>
        ) : (
          <p style={{ margin: 0 }}>No more pairs here — you've judged them all. Thanks! <Link to="/vote">Back to challenges</Link></p>
        )}
      </Card>
    );
  }
  if (!pair) return <p className="muted">Loading…</p>;

  const side = (nominationId: string, submissionId: string) => (
    <button className="pick" onClick={() => pick(nominationId)} disabled={busy} aria-label="Pick this photo">
      <img src={api.photoUrl(submissionId)} alt="option" />
    </button>
  );

  return (
    <div>
      <div className="duel-head">
        <h2>Which is better?</h2>
        <div className="prog">You've judged {judged}</div>
      </div>
      <div className="duel">
        {side(pair.aNominationId, pair.aSubmissionId)}
        <span className="vs">VS</span>
        {side(pair.bNominationId, pair.bSubmissionId)}
      </div>
      <div className="duel-foot">Tap a photo · never your own team</div>
    </div>
  );
}
