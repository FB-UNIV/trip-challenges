// Two entry points:
//  - /join?code=<studentId.secret>  — the emailed join link: redeem, then home.
//  - /join?trip=<tripId>            — the recovery link: request a fresh code by email
//    (lost/changed device). Anti-enumeration: the confirmation is shown unconditionally.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Field } from "../ui.js";

export function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = params.get("code");
  const trip = params.get("trip");

  const [status, setStatus] = useState(code ? "Joining…" : "");
  useEffect(() => {
    if (!code) return;
    api.redeemCode(code).then(
      () => navigate("/", { replace: true }),
      () =>
        setStatus(
          "This link is invalid or has already been used. If you lost your device, ask your teacher for the recovery link to request a fresh code.",
        ),
    );
  }, [code, navigate]);

  if (code) return <Card><p style={{ margin: 0 }}>{status}</p></Card>;
  if (trip) return <ReissueForm tripId={trip} />;
  return <Card><p style={{ margin: 0 }}>Missing code.</p></Card>;
}

function ReissueForm({ tripId }: { tripId: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Card hero>
        <h2>Check your inbox</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          If that email is on this trip, a new access-code link is on its way. Check your inbox
          (and your spam folder).
        </p>
      </Card>
    );
  }

  return (
    <Card hero>
      <h2>Get a new access code</h2>
      <p className="muted tiny" style={{ margin: "6px 0 8px" }}>
        Lost or changed your device? Enter the email your teacher used and we'll send a fresh
        link. Your old device stays signed in until you open the new link.
      </p>
      <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button
        disabled={busy || !email.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await api.requestReissue(tripId, email.trim());
          } catch {
            /* neutral by design — never reveal whether the address matched */
          }
          setSent(true);
        }}
      >
        Send me a new code
      </Button>
    </Card>
  );
}
