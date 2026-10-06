// Read real emails the API sent over SMTP, from Mailpit's HTTP API.
import { expect } from "@playwright/test";
import { MAILPIT_URL } from "./env.js";

export type Mail = { id: string; subject: string; text: string; created: string };
type Summary = { ID: string; Subject: string; Created: string };

async function search(to: string): Promise<Summary[]> {
  const q = encodeURIComponent(`to:"${to}"`);
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${q}&limit=50`);
  if (!res.ok) throw new Error(`mailpit search -> ${res.status}`);
  const body = (await res.json()) as { messages: Summary[] };
  return body.messages ?? [];
}

async function read(id: string): Promise<{ Text: string }> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`mailpit message -> ${res.status}`);
  return (await res.json()) as { Text: string };
}

/** Wait until `to` has received at least `count` mails whose subject matches; oldest first. */
export async function waitForMails(
  to: string,
  { subject = /./, count = 1, timeout = 30_000 }: { subject?: RegExp; count?: number; timeout?: number } = {},
): Promise<Mail[]> {
  let found: Summary[] = [];
  await expect
    .poll(async () => {
      found = (await search(to)).filter((m) => subject.test(m.Subject));
      return found.length;
    }, { timeout, message: `waiting for ${count} mail(s) to ${to} matching ${subject}` })
    .toBeGreaterThanOrEqual(count);
  found.sort((a, b) => a.Created.localeCompare(b.Created));
  return Promise.all(
    found.map(async (m) => ({ id: m.ID, subject: m.Subject, created: m.Created, text: (await read(m.ID)).Text })),
  );
}

export async function waitForMail(to: string, opts: { subject?: RegExp; timeout?: number } = {}): Promise<Mail> {
  const all = await waitForMails(to, opts);
  return all.at(-1)!;
}

/** How many mails `to` has received so far (no waiting). */
export async function mailCount(to: string): Promise<number> {
  return (await search(to)).length;
}

/** First absolute URL in the mail body whose path contains `path`. */
export function linkIn(mail: Mail, path: string): string {
  const url = (mail.text.match(/https?:\/\/\S+/g) ?? []).find((u) => u.includes(path));
  if (!url) throw new Error(`no ${path} link in mail "${mail.subject}":\n${mail.text}`);
  return url;
}

/** Path + query of a link, so it can be opened against the e2e baseURL. */
export const relative = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};
