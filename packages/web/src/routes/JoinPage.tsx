// Two entry points:
//  - /join?code=<studentId.secret>  — the emailed join link: redeem, then home.
//  - /join?trip=<tripId>            — the recovery link: request a fresh code by email
//    (lost/changed device). Anti-enumeration: the confirmation is shown unconditionally.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, errorText, HttpError, isBadCode } from "../api.js";
import { Button, Card, Field, Notice } from "../ui.js";

export function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = params.get("code");
  const trip = params.get("trip");

  const [status, setStatus] = useState(code ? "Connexion…" : "");
  useEffect(() => {
    if (!code) return;
    api.redeemCode(code).then(
      () => navigate("/", { replace: true }),
      (e) =>
        setStatus(isBadCode(e)
          ? "Ce lien n'est pas valide ou a déjà été utilisé. Si tu as perdu ton appareil, demande à ton enseignant le lien de récupération pour recevoir un nouveau code."
          : errorText(e)),
    );
  }, [code, navigate]);

  if (code) return <Card><p style={{ margin: 0 }}>{status}</p></Card>;
  if (trip) return <ReissueForm tripId={trip} />;
  return <Card><p style={{ margin: 0 }}>Code manquant.</p></Card>;
}

function ReissueForm({ tripId }: { tripId: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  if (sent) {
    return (
      <Card hero>
        <h2>Regarde ta boîte mail</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          Si cette adresse fait partie de la sortie, un nouveau lien avec ton code d'accès arrive.
          Regarde ta boîte de réception (et tes spams).
        </p>
      </Card>
    );
  }

  return (
    <Card hero>
      <h2>Recevoir un nouveau code d'accès</h2>
      <p className="muted tiny" style={{ margin: "6px 0 8px" }}>
        Tu as perdu ou changé d'appareil ? Saisis l'adresse e-mail utilisée par ton enseignant et
        on t'envoie un nouveau lien. Ton ancien appareil reste connecté jusqu'à ce que tu ouvres le nouveau lien.
      </p>
      <Field label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button
        disabled={busy || !email.trim()}
        onClick={async () => {
          setBusy(true); setErr("");
          try {
            await api.requestReissue(tripId, email.trim());
          } catch (e) {
            // Neutral by design: whatever the server answered, never reveal whether the address
            // matched. Only an unreachable server (nothing was sent) is worth saying (#69).
            if (e instanceof HttpError && e.status === 0) { setErr(errorText(e)); setBusy(false); return; }
          }
          setSent(true);
        }}
      >
        M'envoyer un nouveau code
      </Button>
      <Notice tone="err">{err}</Notice>
    </Card>
  );
}
