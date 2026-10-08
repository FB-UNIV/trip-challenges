// Students: roster import and the lost-code recovery link.
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { Button, Card, CopyField, Notice, Progress, useAction } from "../../ui.js";
import { useTrip } from "./TripLayout.js";

export function TripStudents() {
  const { tripId } = useTrip();
  return <Roster tripId={tripId} />;
}

function Roster({ tripId }: { tripId: string }) {
  const [text, setText] = useState("");
  const [queued, setQueued] = useState("");
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

  const emails = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const importRoster = useAction(async () => {
    setQueued("");
    const r = await api.importRoster(tripId, emails);
    setQueued(`Queued ${r.queued} of ${r.requested}. Sending access codes in the background…`);
    setText("");
    startPolling();
  }, "Could not import the roster.");
  const sent = status && status.students > 0 ? status : null;

  return (
    <Card>
      <h3>Roster</h3>
      <label className="field">
        <span>Student emails — one per line or comma-separated</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      </label>
      <Button disabled={emails.length === 0} busy={importRoster.busy} onClick={importRoster.run}>Import + email codes</Button>
      <Notice tone="ok">{queued}</Notice>
      <Notice tone="err">{importRoster.error}</Notice>
      {sent && (
        <div className="roster-progress">
          <Progress value={sent.done} max={sent.students} label="Codes emailed" tone="good" />
          <p className="muted tiny mb-0">{sent.done} of {sent.students} codes emailed{sent.pending > 0 && " — sending…"}</p>
          {sent.failed > 0 && (
            <p className="warncard tiny mb-0">
              <b>{sent.failed === 1 ? "1 email failed" : `${sent.failed} emails failed`}</b> — check the address{sent.failed === 1 ? "" : "es"} and import {sent.failed === 1 ? "it" : "them"} again.
            </p>
          )}
        </div>
      )}
      <div className="mt-4">
        <CopyField label="Lost-code recovery link" value={`${location.origin}/join?trip=${tripId}`} />
        <p className="muted tiny mt-0">Share it with any student who changed or lost their device.</p>
      </div>
    </Card>
  );
}
