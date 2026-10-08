// Students: roster import and the lost-code recovery link.
import { useEffect, useRef, useState } from "react";
import { api, HttpError } from "../../api.js";
import { Button, Card, CopyField } from "../../ui.js";
import { useTrip } from "./TripLayout.js";

export function TripStudents() {
  const { tripId } = useTrip();
  return <Roster tripId={tripId} />;
}

function Roster({ tripId }: { tripId: string }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [status, setStatus] = useState<{ pending: number; done: number; failed: number; students: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();

  // Poll progress while anything is still pending; stop when the queue drains.
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await api.rosterStatus(tripId);
        setStatus(s);
        if (s.pending === 0 && timer.current) { clearInterval(timer.current); timer.current = undefined; }
      } catch { /* ignore transient */ }
    };
    poll();
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [tripId]);

  const startPolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const s = await api.rosterStatus(tripId).catch(() => null);
      if (!s) return;
      setStatus(s);
      if (s.pending === 0 && timer.current) { clearInterval(timer.current); timer.current = undefined; }
    }, 2000);
  };

  return (
    <Card>
      <h3>Roster</h3>
      <label className="field">
        <span>Student emails — one per line or comma-separated</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      </label>
      <div style={{ marginTop: 8 }}>
        <Button
          onClick={async () => {
            const emails = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
            if (!emails.length) return;
            setMsg(""); setErr("");
            try {
              const r = await api.importRoster(tripId, emails);
              setMsg(`Queued ${r.queued} of ${r.requested}. Sending access codes in the background…`);
              setText("");
              startPolling();
            } catch (e) {
              setErr(`Could not import${e instanceof HttpError ? `: ${e.reason}` : "."}`);
            }
          }}
        >Import + email codes</Button>
      </div>
      {msg && <p className="ok tiny">{msg}</p>}
      {err && <p className="err tiny">{err}</p>}
      {status && (status.pending > 0 || status.done > 0 || status.failed > 0) && (
        <p className="muted tiny">
          {status.students} students · {status.pending} queued
          {status.done > 0 && ` · ${status.done} emailed`}
          {status.failed > 0 && ` · ${status.failed} failed`}
        </p>
      )}
      <div className="mt-3">
        <CopyField label="Lost-code recovery link" value={`${location.origin}/join?trip=${tripId}`} />
        <p className="muted tiny mt-0">Share it with any student who changed or lost their device.</p>
      </div>
    </Card>
  );
}
