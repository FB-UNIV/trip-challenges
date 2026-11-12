// #104: a roster address whose domain can't receive mail is Undelivered at import, instead of
// sitting at Invited forever. A DNS hiccup must never flag a good address: only a definite
// "this domain has no mail server" counts.
import { describe, it, expect } from "vitest";
import { mailDomainStatus, type MailResolver } from "../src/email/mail-domain.js";

const err = (code: string) => Object.assign(new Error(code), { code });

/** A resolver answering from a table; anything missing is ENODATA (name exists, no record). */
function resolver(table: { mx?: { exchange: string; priority: number }[] | Error; a?: string[] | Error; aaaa?: string[] | Error }): MailResolver {
  const answer = <T>(v: T | Error | undefined): Promise<T> =>
    v instanceof Error ? Promise.reject(v) : v ? Promise.resolve(v) : Promise.reject(err("ENODATA"));
  return {
    resolveMx: async () => answer(table.mx),
    resolve4: async () => answer(table.a),
    resolve6: async () => answer(table.aaaa),
  };
}

describe("mailDomainStatus", () => {
  it("accepts a domain with a mail server", async () => {
    const r = resolver({ mx: [{ exchange: "mx.school.fr", priority: 10 }] });
    expect(await mailDomainStatus("lea@school.fr", r)).toBe("ok");
  });

  it("flags a domain that doesn't exist (a typo like shcool.fr)", async () => {
    const r = resolver({ mx: err("ENOTFOUND") });
    expect(await mailDomainStatus("lea@shcool.fr", r)).toBe("missing");
  });

  it("flags a domain that declares it takes no mail (null MX, RFC 7505)", async () => {
    const r = resolver({ mx: [{ exchange: "", priority: 0 }] });
    expect(await mailDomainStatus("lea@nomail.fr", r)).toBe("missing");
  });

  it("accepts a domain without MX that has an address (implicit MX, RFC 5321)", async () => {
    expect(await mailDomainStatus("lea@small.fr", resolver({ a: ["192.0.2.1"] }))).toBe("ok");
    expect(await mailDomainStatus("lea@small.fr", resolver({ aaaa: ["2001:db8::1"] }))).toBe("ok");
  });

  it("flags a domain with neither MX nor address", async () => {
    expect(await mailDomainStatus("lea@parked.fr", resolver({}))).toBe("missing");
  });

  it("never flags on a DNS failure: timeouts and server errors are 'unknown'", async () => {
    expect(await mailDomainStatus("lea@school.fr", resolver({ mx: err("ETIMEOUT") }))).toBe("unknown");
    expect(await mailDomainStatus("lea@school.fr", resolver({ mx: err("ESERVFAIL") }))).toBe("unknown");
    // No MX, and the address lookup itself fails: still not a verdict.
    expect(await mailDomainStatus("lea@school.fr", resolver({ a: err("ETIMEOUT") }))).toBe("unknown");
  });

  it("gives up after a timeout rather than holding the roster worker", async () => {
    const hang: MailResolver = {
      resolveMx: () => new Promise(() => {}),
      resolve4: () => new Promise(() => {}),
      resolve6: () => new Promise(() => {}),
    };
    expect(await mailDomainStatus("lea@school.fr", hang, 20)).toBe("unknown");
  });
});
