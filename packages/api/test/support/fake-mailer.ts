// Recording stand-in for src/email/mailer.ts.
// Mock with: vi.mock("../src/email/mailer.js", () => import("./support/fake-mailer.js"))
export type Mail = { kind: string; to: string; args: unknown[] };

export const sent: Mail[] = [];
// fail: every send throws; failTimes: the next N sends throw (transient outage).
export const mailer = { fail: false, failTimes: 0 };

export function resetMailer() {
  sent.length = 0;
  mailer.fail = false;
  mailer.failTimes = 0;
}

function record(kind: string, to: string, args: unknown[]) {
  const failNow = mailer.fail || (mailer.failTimes > 0 && mailer.failTimes-- > 0);
  if (failNow) throw Object.assign(new Error(`550 rejected <${to}>`), { code: "EENVELOPE" });
  sent.push({ kind, to, args });
}

export async function sendMail(to: string, subject: string, text: string) {
  record("raw", to, [subject, text]);
}
export async function sendAccessCode(to: string, tripName: string, joinUrl: string) {
  record("access_code", to, [tripName, joinUrl]);
}
export async function sendCoTeacherInvite(to: string, tripName: string, acceptUrl: string) {
  record("invite", to, [tripName, acceptUrl]);
}
export async function sendErasureWarning(to: string, tripName: string, when: Date) {
  record("erasure_warning", to, [tripName, when]);
}
