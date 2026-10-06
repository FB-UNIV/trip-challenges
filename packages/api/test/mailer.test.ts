import { vi, describe, it, expect, afterEach } from "vitest";

// mailer.ts builds its SMTP transport at import time, so each case re-imports it under
// a different config.
const transport = vi.hoisted(() => ({ opts: null as any, sendMail: vi.fn(async (_m: unknown) => ({})) }));
vi.mock("nodemailer", () => ({
  default: { createTransport: (opts: unknown) => { transport.opts = opts; return { sendMail: transport.sendMail }; } },
}));

async function loadMailer(smtp: Record<string, unknown>) {
  vi.resetModules();
  const { config } = await import("./support/config.js");
  vi.doMock("../src/config.js", () => ({ config: { ...config, ...smtp } }));
  return import("../src/email/mailer.js");
}

afterEach(() => {
  transport.opts = null;
  transport.sendMail.mockClear();
  vi.restoreAllMocks();
});

describe("mailer", () => {
  it("logs instead of sending when SMTP is not configured (dev)", async () => {
    const m = await loadMailer({ SMTP_HOST: undefined });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await m.sendMail("a@school.test", "Hi", "body");
    expect(transport.opts).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[mail:dev] to=a@school.test :: Hi"));
  });

  it("sends through SMTP with auth, implicit TLS on 465", async () => {
    const m = await loadMailer({ SMTP_HOST: "smtp.test", SMTP_PORT: 465, SMTP_USER: "u", SMTP_PASSWORD: "p" });
    expect(transport.opts).toEqual({ host: "smtp.test", port: 465, secure: true, auth: { user: "u", pass: "p" } });
    await m.sendMail("a@school.test", "Hi", "body");
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: "Trip Challenges <no-reply@example.org>", to: "a@school.test", subject: "Hi", text: "body",
    });
  });

  it("uses secure=false and no auth on 587 without a user", async () => {
    await loadMailer({ SMTP_HOST: "smtp.test", SMTP_PORT: 587, SMTP_USER: undefined });
    expect(transport.opts).toEqual({ host: "smtp.test", port: 587, secure: false, auth: undefined });
  });

  it("formats the three message kinds", async () => {
    const m = await loadMailer({ SMTP_HOST: "smtp.test" });
    await m.sendAccessCode("kid@school.test", "Rome", "http://app.test/join?code=x");
    await m.sendCoTeacherInvite("co@school.test", "Rome", "http://app.test/teacher/accept?token=y");
    await m.sendErasureWarning("owner@school.test", "Rome", new Date("2030-01-02T03:04:05Z"));

    const [code, invite, warn] = transport.sendMail.mock.calls.map((c) => c[0] as { subject: string; text: string });
    expect(code!.subject).toBe("Your access code for Rome");
    expect(code!.text).toContain("http://app.test/join?code=x");
    expect(invite!.subject).toBe("You've been invited to co-manage Rome");
    expect(invite!.text).toContain("expires in 7 days");
    expect(warn!.subject).toBe("Data for Rome will be erased");
    expect(warn!.text).toContain("2030-01-02T03:04:05.000Z");
  });

  it("formats the erasure-failure alert", async () => {
    const m = await loadMailer({ SMTP_HOST: "smtp.test" });
    await m.sendErasureFailedAlert("ops@school.test", "Rome", "trip-uuid", "vault 503 sealed");
    const mail = transport.sendMail.mock.calls[0]![0] as { subject: string; text: string };
    expect(mail.subject).toBe("ACTION NEEDED: erasure failed for Rome");
    expect(mail.text).toContain("trip-uuid");
    expect(mail.text).toContain("vault 503 sealed");
    expect(mail.text).toContain("retried automatically");
  });
});
