import { useRef, useState } from "react";
import { useParams } from "react-router";
import type { EntryState } from "@trip/shared";
import { api, errorText, HttpError, isBadCode } from "../api.js";
import { qk, useLoad, useMe, useOptimistic, useRefresh } from "../query.js";
import { Button, Card, Field, PhasePill, phaseMeta, Skeleton } from "../ui.js";
import { PlaySolo } from "./PlaySolo.js";

export function ChallengePage() {
  const { qrSlug } = useParams();
  const challenge = useLoad(qk.challengeBySlug(qrSlug!), () => api.resolveChallenge(qrSlug!));
  const me = useMe(); // signed out = no data: the code form below
  const refresh = useRefresh();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  if (challenge.loading) return <Card><Skeleton /></Card>;
  if (challenge.error) return <Card><p style={{ margin: 0 }}>Défi introuvable.</p></Card>;
  const ch = challenge.data!;
  const authed = !!me.data;

  return (
    <div className="stack">
      <Card hero raise>
        <div className="row" style={{ marginBottom: 8 }}>
          <PhasePill phase={me.data?.phase ?? "challenge"} dot />
        </div>
        <h2>{ch.title}</h2>
        <p className="muted" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{ch.instructions}</p>
      </Card>

      {!authed ? (
        <Card>
          <h3>Saisis ton code d'accès pour envoyer des photos</h3>
          <Field label="Code d'accès" className="input-mono" placeholder="FOX-7Q2K" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button
            onClick={async () => {
              try { await api.redeemCode(code.trim()); await refresh(qk.student); }
              catch (e) { setErr(isBadCode(e) ? "Code non valide." : errorText(e)); }
            }}
          >Continuer</Button>
          {err && <p className="err tiny" style={{ marginBottom: 0 }}>{err}</p>}
        </Card>
      ) : me.data!.phase !== "challenge" ? (
        <Card><p className="muted" style={{ margin: 0 }}>L'envoi de photos est fermé (phase : {phaseMeta(me.data!.phase).label}).</p></Card>
      ) : !me.data!.teamId ? (
        <Card><PlaySolo /></Card>
      ) : (
        <UploadAndNominate challengeId={ch.id} />
      )}
    </div>
  );
}

const ENTRY_LABEL: Record<EntryState, string> = {
  pending: "⏳ En attente de ton enseignant",
  approved: "✅ Validée",
  rejected: "❌ Refusée",
};

function UploadAndNominate({ challengeId }: { challengeId: string }) {
  // Live: teammates upload to the same challenge from their own phones.
  const subs = useLoad(qk.submissions(challengeId), () => api.listSubmissions(challengeId), { live: true });
  const refresh = useRefresh();
  const changed = () => refresh(qk.submissions(challengeId), qk.myChallenges); // the photos here, the checklist, the badge
  const optimistic = useOptimistic();
  type Subs = Awaited<ReturnType<typeof api.listSubmissions>>;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  return (
    <>
      <Card>
        <div className="upload">
          <span className="cam">📸</span>
          <b>Ajouter une photo</b>
          <span className="muted tiny">Tous les membres de l'équipe peuvent ajouter des photos à ce défi</span>
          {/* capture opens the camera on mobile; users can also pick from gallery */}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="file-input" />
          <Button
            disabled={busy}
            onClick={async () => {
              const f = fileRef.current?.files?.[0];
              if (!f) return;
              setBusy(true); setErr("");
              try { await api.uploadSubmission(challengeId, f); if (fileRef.current) fileRef.current.value = ""; await changed(); }
              catch (e) { setErr(e instanceof HttpError ? e.reason : "Échec de l'envoi"); }
              finally { setBusy(false); }
            }}
          >{busy ? "Envoi…" : "Envoyer"}</Button>
          {err && <p className="err tiny" style={{ margin: 0 }}>{err}</p>}
        </div>
      </Card>

      <Card>
        <h3 style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          Les photos de ton équipe
          <span className="muted tiny" style={{ fontWeight: 600, marginLeft: "auto" }}>choisis celle à mettre en lice</span>
        </h3>
        {subs.loading && <Skeleton photos={2} />}
        {subs.data?.submissions.length === 0 && <p className="muted">Pas encore de photo.</p>}
        {/* #81: say why the entry is gone, instead of the mark just vanishing. */}
        {subs.data && !subs.data.submissions.some((s) => s.nominated) && subs.data.submissions.some((s) => s.entry === "rejected") && (
          <p className="warncard">Ton enseignant a refusé ta photo. Choisis-en une autre.</p>
        )}
        <div className="grid2" style={{ marginTop: 10 }}>
          {subs.data?.submissions.map((s) => (
            <div key={s.id} className="photo-cell">
              <img src={api.photoUrl(s.id)} alt="" className="photo" style={{ aspectRatio: "1" }} />
              {s.entry && <span className={`entry-badge entry-${s.entry}`}>{ENTRY_LABEL[s.entry]}</span>}
              <Button
                variant={s.nominated ? "gold" : "ghost"} size="mini"
                onClick={async () => {
                  setErr("");
                  try {
                    // Optimistic: the mark moves to this photo at once (a team has one nomination per challenge).
                    await optimistic<Subs>(
                      qk.submissions(challengeId),
                      // The new entry is pending; the one it replaces is retired (a rejection stays marked).
                      (old) => ({ submissions: old.submissions.map((x) => ({
                        ...x, nominated: x.id === s.id,
                        entry: x.id === s.id ? "pending" : x.entry === "rejected" ? "rejected" : null,
                      })) }),
                      () => api.nominate(challengeId, s.id),
                    );
                    await changed();
                  }
                  catch (e) { setErr(e instanceof HttpError ? e.reason : "Échec de la sélection"); }
                }}
              >{s.nominated ? "Sélectionnée ✓" : "Sélectionner"}</Button>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
