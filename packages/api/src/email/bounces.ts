// Bounces (#104). A relay accepts mail for a mailbox that doesn't exist and only fails it
// later, so the student stayed Invited forever. Every few minutes, ask Scaleway TEM for this
// project's failed emails and put the matching students back to Undelivered — the teacher's
// Fix address / Resend then apply as for a refused send.
// A failed email is matched to a student by the Message-ID we minted for their access-code
// mail, never by address: TEM's answer carries the student's address (mail_rcpt) and its
// status text can too, so neither is read, logged or stored (ADR 0001).
import { config } from "../config.js";
import { pool } from "../db.js";

const POLL_EVERY_MS = 5 * 60_000;
// A failure lands within TEM's retry window (a few days); a week back covers it with margin.
const LOOKBACK_MS = 7 * 24 * 3600_000;
const PAGE_SIZE = 100;

type TemEmail = { message_id: string; flags?: string[] };
type TemPage = { total_count: number; emails: TemEmail[] };

let lastPoll = 0;
/** Tests only: forget when we last polled. */
export function resetBouncePoll() {
  lastPoll = 0;
}

/** Marks the bounced students Undelivered; returns how many. No-op unless TEM is configured, at most every 5 minutes. */
export async function pollBounces(now = new Date()): Promise<number> {
  const { SCW_TEM_PROJECT_ID: project, SCW_TEM_SECRET_KEY: key, SCW_TEM_REGION: region } = config;
  if (!project || !key) return 0;
  if (lastPoll && now.getTime() - lastPoll < POLL_EVERY_MS) return 0;
  lastPoll = now.getTime();

  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  let marked = 0;
  for (let page = 1; ; page++) {
    const url = new URL(`https://api.scaleway.com/transactional-email/v1alpha1/regions/${region}/emails`);
    url.search = new URLSearchParams({
      project_id: project, statuses: "failed", since, page: String(page), page_size: String(PAGE_SIZE),
    }).toString();
    const res = await fetch(url.toString(), { headers: { "X-Auth-Token": key }, signal: AbortSignal.timeout(10_000) });
    // The status only: the body can echo a student's address.
    if (!res.ok) throw new Error(`TEM ListEmails failed: HTTP ${res.status}`);
    const body = (await res.json()) as TemPage;
    for (const email of body.emails) marked += await markBounced(email);
    if (body.emails.length < PAGE_SIZE || page * PAGE_SIZE >= body.total_count) break;
  }
  return marked;
}

async function markBounced(email: TemEmail): Promise<number> {
  // We send it as <uuid@domain>; TEM reports only the uuid (seen on staging), so match on the
  // local part, whatever brackets or domain the report carries. The uuid alone is unique.
  const localPart = email.message_id.replace(/^<|>$/g, "").split("@")[0];
  if (!localPart) return 0;
  // Only the student's latest mail counts (a resend mints a new id), and never a student who
  // has joined: the code reached them, whatever the relay says.
  const { rowCount } = await pool.query(
    `UPDATE student s SET access_code_sent_at = NULL, mail_error = $2
      WHERE s.mail_message_id IS NOT NULL AND split_part(btrim(s.mail_message_id, '<>'), '@', 1) = $1
        AND s.access_code_sent_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM student_session ss WHERE ss.student_id = s.id)`,
    [localPart, reasonOf(email.flags ?? [])],
  );
  return rowCount ?? 0;
}

const REASONS: [flag: string, code: string][] = [
  ["mailbox_not_found", "MAILBOX_NOT_FOUND"],
  ["mailbox_full", "MAILBOX_FULL"],
  ["blocklisted", "BLOCKLISTED"],
  ["spam", "SPAM"],
];
const reasonOf = (flags: string[]) => REASONS.find(([flag]) => flags.includes(flag))?.[1] ?? "BOUNCED";
