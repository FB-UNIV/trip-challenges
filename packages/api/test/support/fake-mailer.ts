// Recording stand-in for src/email/mailer.ts.
// Mock with: vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"))
export type Mail = { kind: string; to: string; args: unknown[]; messageId?: string };

export const sent: Mail[] = [];
// fail: every send throws; failTimes: the next N sends throw (transient outage);
// hold: access-code sends wait on it (a slow SMTP relay).
// deadDomains: domains with no mail server; unknownDomains: DNS can't tell (#104).
export const mailer = {
  fail: false,
  failTimes: 0,
  hold: null as Promise<void> | null,
  deadDomains: new Set<string>(),
  unknownDomains: new Set<string>(),
};

let seq = 0;
export function resetMailer() {
  sent.length = 0;
  mailer.fail = false;
  mailer.failTimes = 0;
  mailer.hold = null;
  mailer.deadDomains.clear();
  mailer.unknownDomains.clear();
}

function record(kind: string, to: string, args: unknown[], messageId?: string) {
  const failNow = mailer.fail || (mailer.failTimes > 0 && mailer.failTimes-- > 0);
  if (failNow) throw Object.assign(new Error(`550 rejected <${to}>`), { code: "EENVELOPE" });
  sent.push({ kind, to, args, ...(messageId ? { messageId } : {}) });
}

export async function mailDomainStatus(email: string): Promise<"ok" | "missing" | "unknown"> {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (mailer.deadDomains.has(domain)) return "missing";
  if (mailer.unknownDomains.has(domain)) return "unknown";
  return "ok";
}

export async function sendMail(to: string, subject: string, text: string) {
  record("raw", to, [subject, text]);
}
export async function sendAccessCode(to: string, tripName: string, joinUrl: string): Promise<string> {
  if (mailer.hold) await mailer.hold;
  const messageId = `<fake-${++seq}@mail.test>`;
  record("access_code", to, [tripName, joinUrl], messageId);
  return messageId;
}
export async function sendCoTeacherInvite(to: string, tripName: string, acceptUrl: string) {
  record("invite", to, [tripName, acceptUrl]);
}
export async function sendErasureWarning(to: string, tripName: string, when: Date) {
  record("erasure_warning", to, [tripName, when]);
}
export async function sendErasureFailedAlert(to: string, tripName: string, tripId: string, detail: string) {
  record("erasure_failed", to, [tripName, tripId, detail]);
}
