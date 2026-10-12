import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useParams } from "react-router";
import type { EntryState } from "@trip/shared";
import { api, errorText, HttpError, isBadCode } from "../api.js";
import { qk, useLoad, useMe, useOptimistic, useRefresh } from "../query.js";
import { Button, Card, Celebrate, Field, PhasePill, phaseMeta, Progress, Skeleton } from "../ui.js";
import { shrinkPhoto } from "../photo.js";
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
  // One photo is looked at full screen before it goes (`review`); once it's in, the team may make it their entry (`sent`).
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const uploads = useUploads(challengeId, changed, (u, id) => { if (u.reviewed) setSheet({ kind: "sent", id }); });
  const [err, setErr] = useState("");
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = ""; // the same photo can be picked again
    if (files.length === 1) setSheet({ kind: "review", file: files[0]!, preview: URL.createObjectURL(files[0]!), from: e.target });
    else uploads.add(files); // a batch from the gallery just goes
  };
  const closeReview = (r: Review) => { URL.revokeObjectURL(r.preview); setSheet(null); };
  const hasEntry = !!subs.data?.submissions.some((s) => s.nominated);

  const nominate = async (id: string) => {
    setErr("");
    try {
      // Optimistic: the mark moves to this photo at once (a team has one nomination per challenge).
      await optimistic<Subs>(
        qk.submissions(challengeId),
        // The new entry is pending; the one it replaces is retired (a rejection stays marked).
        (old) => ({ submissions: old.submissions.map((x) => ({
          ...x, nominated: x.id === id,
          entry: x.id === id ? "pending" : x.entry === "rejected" ? "rejected" : null,
        })) }),
        () => api.nominate(challengeId, id),
      );
      await changed();
    }
    catch (e) { setErr(e instanceof HttpError ? e.reason : "Échec de la sélection"); }
  };

  return (
    <>
      <Card>
        <div className="upload">
          <span className="cam" aria-hidden="true">📸</span>
          <b>Ajoute vos photos</b>
          <span className="muted tiny">Tous les membres de l'équipe peuvent en ajouter</span>
          <div className="upload-acts">
            <label className="btn btn-lg">
              <span aria-hidden="true">📸</span> Prendre une photo
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
            </label>
            <label className="btn btn-lg btn-soft">
              <span aria-hidden="true">🖼️</span> Galerie
              <input type="file" accept="image/*" multiple className="sr-only" onChange={pick} />
            </label>
          </div>
        </div>
      </Card>

      <Card>
        <h3 style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          Les photos de ton équipe
          <span className="muted tiny" style={{ fontWeight: 600, marginLeft: "auto" }}>choisis celle à mettre en lice</span>
        </h3>
        {subs.loading && <Skeleton photos={2} />}
        {subs.data?.submissions.length === 0 && uploads.items.length === 0 && <p className="muted">Pas encore de photo.</p>}
        {/* #81: say why the entry is gone, instead of the mark just vanishing. */}
        {subs.data && !subs.data.submissions.some((s) => s.nominated) && subs.data.submissions.some((s) => s.entry === "rejected") && (
          <p className="warncard">Ton enseignant a refusé ta photo. Choisis-en une autre.</p>
        )}
        <div className="grid2" style={{ marginTop: 10 }}>
          {subs.data?.submissions.map((s) => (
            <div key={s.id} className="photo-cell">
              <img src={api.photoUrl(s.id)} alt="" className="photo" style={{ aspectRatio: "1" }} />
              {s.entry && <span className={`entry-badge entry-${s.entry}`}>{ENTRY_LABEL[s.entry]}</span>}
              <Button variant={s.nominated ? "gold" : "ghost"} size="mini" onClick={() => nominate(s.id)}>{s.nominated ? "Sélectionnée ✓" : "Sélectionner"}</Button>
            </div>
          ))}
          {uploads.items.map((u) => (
            <div key={u.key} className="photo-cell photo-sending">
              <img src={u.preview} alt="Photo en cours d'envoi" className="photo" style={{ aspectRatio: "1" }} />
              {u.error ? (
                <>
                  <p className="err tiny" style={{ margin: 0 }}>{u.error}</p>
                  <div className="row">
                    <Button size="mini" onClick={() => uploads.retry(u)}>Réessayer</Button>
                    <Button size="mini" variant="ghost" onClick={() => uploads.drop(u)}>Retirer</Button>
                  </div>
                </>
              ) : u.sent === null ? (
                <span className="muted tiny">En attente…</span>
              ) : (
                <Progress value={Math.round(u.sent * 100)} max={100} label="Envoi de la photo" />
              )}
            </div>
          ))}
        </div>
        {err && <p className="err tiny" style={{ marginBottom: 0 }}>{err}</p>}
      </Card>

      {sheet?.kind === "review" && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Ta photo">
          <button className="lb-close" aria-label="Annuler" onClick={() => closeReview(sheet)}>✕</button>
          <img src={sheet.preview} alt="Ta photo" className="sheet-photo" />
          <div className="sheet-acts">
            <Button
              variant="neutral" size="lg"
              onClick={() => { closeReview(sheet); sheet.from.click(); }}
            ><span aria-hidden="true">↺</span> Reprendre</Button>
            <Button
              size="lg"
              onClick={() => { closeReview(sheet); uploads.add([sheet.file], true); }}
            >Envoyer <span aria-hidden="true">➜</span></Button>
          </div>
        </div>
      )}
      {sheet?.kind === "sent" && (
        <div className="sheet sheet-sent" role="dialog" aria-modal="true" aria-label="Photo envoyée">
          <Celebrate icon="🎉" title="Photo envoyée !">
            {hasEntry ? "Elle est avec les photos de ton équipe." : "C'est votre photo pour le vote ?"}
          </Celebrate>
          <div className="sheet-acts">
            {hasEntry ? (
              <Button size="lg" onClick={() => setSheet(null)}>Continuer</Button>
            ) : (
              <>
                <Button variant="neutral" size="lg" onClick={() => setSheet(null)}>Plus tard</Button>
                <Button
                  variant="gold" size="lg"
                  onClick={() => { const { id } = sheet; setSheet(null); void nominate(id); }}
                ><span aria-hidden="true">⭐</span> On la met en lice</Button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

type Review = { kind: "review"; file: File; preview: string; from: HTMLInputElement };
type Sheet = Review | { kind: "sent"; id: string };

/** A photo on its way: `sent` is 0 → 1 while it uploads, null while it waits its turn. */
type Upload = { key: number; file: File; preview: string; reviewed: boolean; sent: number | null; error?: string };

/** Photos send one at a time, in the order picked; a failed one stays on screen to retry or drop. */
function useUploads(challengeId: string, onSent: () => Promise<unknown>, onUploaded: (u: Upload, id: string) => void) {
  const [items, setItems] = useState<Upload[]>([]);
  const queue = useRef(Promise.resolve());
  const keys = useRef(0);
  const previews = useRef(new Set<string>());
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const patch = (key: number, change: Partial<Upload>) =>
    setItems((all) => all.map((u) => (u.key === key ? { ...u, ...change } : u)));
  const drop = (u: Upload) => {
    URL.revokeObjectURL(u.preview);
    previews.current.delete(u.preview);
    setItems((all) => all.filter((x) => x.key !== u.key));
  };
  const send = (u: Upload) => {
    queue.current = queue.current.then(async () => {
      patch(u.key, { sent: 0 });
      try {
        const photo = await shrinkPhoto(u.file);
        const { id } = await api.uploadSubmission(challengeId, photo, (sent) => patch(u.key, { sent }));
        await onSent(); // listed before its preview goes: no flicker
        drop(u);
        onUploaded(u, id);
      } catch (e) {
        patch(u.key, { sent: null, error: errorText(e, "Échec de l'envoi.") });
      }
    });
  };

  return {
    items,
    drop,
    /** `reviewed`: the student looked at it full screen first, so tell them when it's in. */
    add: (files: File[], reviewed = false) => {
      const fresh = files.map((file) => ({ key: keys.current++, file, preview: URL.createObjectURL(file), reviewed, sent: null }));
      fresh.forEach((u) => previews.current.add(u.preview));
      setItems((all) => [...all, ...fresh]);
      fresh.forEach(send);
    },
    retry: (u: Upload) => {
      patch(u.key, { error: undefined });
      send(u);
    },
  };
}
