// Tell a student when a Teacher decides on their Team's entry (validated / refused), on any
// student screen. It reads the challenge list the shell already polls, and remembers on this
// phone which decisions it has shown: one made while the app was closed shows on the way back.
// Stored: challenge ids and entry states only, nothing about the student.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { EntryState, StudentChallenge } from "@trip/shared";

type Seen = Record<string, EntryState | null>;
type Decision = { title: string; qrSlug: string; entry: "approved" | "rejected" };

const storageKey = (tripId: string) => `entries-seen:${tripId}`;

function load(tripId: string): Seen {
  try {
    return JSON.parse(localStorage.getItem(storageKey(tripId)) ?? "{}") as Seen;
  } catch {
    return {}; // private mode, or unreadable: start from this visit
  }
}

function save(tripId: string, seen: Seen) {
  try {
    localStorage.setItem(storageKey(tripId), JSON.stringify(seen));
  } catch {
    // private mode / full: remember for this visit only
  }
}

const isDecision = (e: EntryState | null): e is Decision["entry"] => e === "approved" || e === "rejected";

/** `challenges`: undefined until the list has loaded. */
export function EntryToasts({ tripId, challenges }: { tripId: string; challenges: StudentChallenge[] | undefined }) {
  const seen = useRef<{ tripId: string; entries: Seen } | null>(null);
  const [queue, setQueue] = useState<Decision[]>([]);

  useEffect(() => {
    if (!challenges) return;
    if (seen.current?.tripId !== tripId) seen.current = { tripId, entries: load(tripId) };
    const before = seen.current.entries;
    const now: Seen = { ...before };
    const news: Decision[] = [];
    for (const c of challenges) {
      // Only a change this phone saw coming: a first sight (new phone, new challenge) is old news.
      if (c.id in before && before[c.id] !== c.entry && isDecision(c.entry)) {
        news.push({ title: c.title, qrSlug: c.qrSlug, entry: c.entry });
      }
      now[c.id] = c.entry;
    }
    seen.current.entries = now;
    save(tripId, now);
    if (news.length) setQueue((q) => [...q, ...news]);
  }, [tripId, challenges]);

  const top = queue[0];
  if (!top) return null;
  const dismiss = () => setQueue((q) => q.slice(1));
  const ok = top.entry === "approved";
  return (
    <div className={`toast ${ok ? "toast-good" : "toast-crit"}`} role="status" aria-label="Notification">
      <div className="toast-body">
        <b><span aria-hidden="true">{ok ? "✅" : "❌"}</span> {ok ? "Photo validée !" : "Photo refusée"}</b>
        <span>{ok ? `« ${top.title} » est en lice pour le vote.` : `« ${top.title} » : choisis-en une autre.`}</span>
      </div>
      <Link to={`/c/${top.qrSlug}`} className="btn btn-mini" onClick={dismiss}>Voir</Link>
      <button type="button" className="toast-x" aria-label="Fermer la notification" onClick={dismiss}>✕</button>
    </div>
  );
}
