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

  if (!token) return <Card><p style={{ margin: 0 }}>Missing invite token.</p></Card>;
  if (preview.loading) return <Card><Skeleton /></Card>;

  if (preview.error || !preview.data) {
    return <Card><h2>Invite not found</h2><p className="muted" style={{ marginBottom: 0 }}>This invite is invalid or has already been used.</p></Card>;
  }
  if (preview.data.expired) {
    return <Card><h2>Invite expired</h2><p className="muted" style={{ marginBottom: 0 }}>Ask the trip owner to send a new invite.</p></Card>;
  }

  return (
    <Card hero>
      <h2>Co-teacher invite</h2>
      <p style={{ margin: "6px 0 0" }}>You've been invited to co-manage <b>{preview.data.trip_name}</b>.</p>
      <p className="muted tiny" style={{ margin: "6px 0 12px" }}>Sign in as <b>{preview.data.email}</b> to accept.</p>
      <Button disabled={busy} onClick={acceptNow}>Sign in &amp; accept</Button>
      {error && <p className="err tiny" style={{ marginBottom: 0 }}>{error}</p>}
    </Card>
  );
}

function describe(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  if (m.includes("wrong_account")) return "This invite was sent to a different email address. Sign in with that account.";
  if (m.includes("not_found")) return "This invite is invalid, already used, or expired.";
  return "Could not accept the invite.";
}
