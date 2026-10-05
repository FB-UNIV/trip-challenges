import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Field, PhasePill, useAsync } from "../ui.js";

export function ChallengePage() {
  const { qrSlug } = useParams();
  const challenge = useAsync(() => api.resolveChallenge(qrSlug!), [qrSlug]);
  const me = useAsync(() => api.me().catch(() => null), []);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  if (challenge.loading) return <p className="muted">Loading…</p>;
  if (challenge.error) return <Card><p style={{ margin: 0 }}>Challenge not found.</p></Card>;
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
          <h3>Enter your access code to upload</h3>
          <Field label="Access code" className="input-mono" placeholder="FOX-7Q2K" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button
            onClick={async () => {
              try { await api.redeemCode(code.trim()); me.reload(); } catch { setErr("Invalid code."); }
            }}
          >Continue</Button>
          {err && <p className="err tiny" style={{ marginBottom: 0 }}>{err}</p>}
        </Card>
      ) : me.data!.phase !== "challenge" ? (
        <Card><p className="muted" style={{ margin: 0 }}>Uploads are closed (phase: {me.data!.phase}).</p></Card>
      ) : !me.data!.teamId ? (
        <Card><p style={{ margin: 0 }}>Join a team first, then come back to upload. <Link to="/team">Go to teams →</Link></p></Card>
      ) : (
        <UploadAndNominate challengeId={ch.id} />
      )}
    </div>
  );
}

function UploadAndNominate({ challengeId }: { challengeId: string }) {
  const subs = useAsync(() => api.listSubmissions(challengeId), [challengeId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  return (
    <>
      <Card>
        <div className="upload">
          <span className="cam">📸</span>
          <b>Add a photo</b>
          <span className="muted tiny">Any teammate can add to this challenge</span>
          {/* capture opens the camera on mobile; users can also pick from gallery */}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="file-input" />
          <Button
            disabled={busy}
            onClick={async () => {
              const f = fileRef.current?.files?.[0];
              if (!f) return;
              setBusy(true); setErr("");
              try { await api.uploadSubmission(challengeId, f); if (fileRef.current) fileRef.current.value = ""; subs.reload(); }
              catch (e: any) { setErr(e?.message ?? "Upload failed"); }
              finally { setBusy(false); }
            }}
          >{busy ? "Uploading…" : "Upload"}</Button>
          {err && <p className="err tiny" style={{ margin: 0 }}>{err}</p>}
        </div>
      </Card>

      <Card>
        <h3 style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          Your team's photos
          <span className="muted tiny" style={{ fontWeight: 600, marginLeft: "auto" }}>pick one to enter</span>
        </h3>
        {subs.loading && <p className="muted">Loading…</p>}
        {subs.data?.submissions.length === 0 && <p className="muted">No photos yet.</p>}
        <div className="grid2" style={{ marginTop: 10 }}>
          {subs.data?.submissions.map((s) => (
            <div key={s.id} className="photo-cell">
              <img src={api.photoUrl(s.id)} alt="" className="photo" style={{ aspectRatio: "1" }} />
              <Button
                variant={s.nominated ? "gold" : "ghost"} size="mini"
                onClick={async () => { await api.nominate(challengeId, s.id); subs.reload(); }}
              >{s.nominated ? "Nominated ✓" : "Nominate"}</Button>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
