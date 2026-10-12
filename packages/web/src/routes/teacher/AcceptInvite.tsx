import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, HttpError } from "../../api.js";
import { Button, Card, Skeleton, useAsync } from "../../ui.js";

export function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const preview = useAsync(() => api.previewInvite(token), [token]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // If we're already signed in (e.g. returning from OIDC), accept automatically.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.acceptInvite(token);
        if (!cancelled) navigate(`/teacher/trips/${r.tripId}`);
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) return; // not signed in yet — show button
        if (!cancelled) setError(describe(e));
      }
    })();
    return () => { cancelled = true; };
  }, [token, navigate]);

  const signInAndAccept = () => {
    const returnTo = `/teacher/accept?token=${encodeURIComponent(token)}`;
    window.location.href = `/api/auth/teacher/login?returnTo=${encodeURIComponent(returnTo)}`;
  };

  const acceptNow = async () => {
    setBusy(true); setError("");
    try {
      const r = await api.acceptInvite(token);
      navigate(`/teacher/trips/${r.tripId}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) return signInAndAccept();
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  if (!token) return <Card><p style={{ margin: 0 }}>Jeton d'invitation manquant.</p></Card>;
  if (preview.loading) return <Card><Skeleton /></Card>;

  if (preview.error || !preview.data) {
    return <Card><h2>Invitation introuvable</h2><p className="muted" style={{ marginBottom: 0 }}>Cette invitation n'est pas valide ou a déjà été utilisée.</p></Card>;
  }
  if (preview.data.expired) {
    return <Card><h2>Invitation expirée</h2><p className="muted" style={{ marginBottom: 0 }}>Demande au responsable de la sortie de t'envoyer une nouvelle invitation.</p></Card>;
  }

  return (
    <Card hero>
      <h2>Invitation co-enseignant</h2>
      <p style={{ margin: "6px 0 0" }}>Tu es invité à co-gérer <b>{preview.data.trip_name}</b>.</p>
      <p className="muted tiny" style={{ margin: "6px 0 12px" }}>Connecte-toi avec <b>{preview.data.email}</b> pour accepter.</p>
      <Button disabled={busy} onClick={acceptNow}>Se connecter et accepter</Button>
      {error && <p className="err tiny" style={{ marginBottom: 0 }}>{error}</p>}
    </Card>
  );
}

function describe(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  if (m.includes("wrong_account")) return "Cette invitation a été envoyée à une autre adresse e-mail. Connecte-toi avec ce compte.";
  if (m.includes("not_found")) return "Cette invitation n'est pas valide, a déjà été utilisée ou a expiré.";
  return "Impossible d'accepter l'invitation.";
}
