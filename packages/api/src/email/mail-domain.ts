// Can this address's domain receive mail at all? (#104) A typo'd domain (lea@shcool.fr) is
// accepted by the relay and only fails later, so the roster worker asks DNS first.
// Only a definite answer counts: a DNS hiccup must never flag a good address, so any lookup
// failure other than "no such domain / no such record" is "unknown" and the mail goes out.
import { promises as dns } from "node:dns";

export type MailDomainStatus = "ok" | "missing" | "unknown";
export type MailResolver = Pick<typeof dns, "resolveMx" | "resolve4" | "resolve6">;

const NO_RECORD = new Set(["ENOTFOUND", "ENODATA"]); // NXDOMAIN, or the name has no such record

export async function mailDomainStatus(
  email: string, resolver: MailResolver = dns, timeoutMs = 5000,
): Promise<MailDomainStatus> {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<MailDomainStatus>((resolve) => { timer = setTimeout(() => resolve("unknown"), timeoutMs); });
  try {
    return await Promise.race([lookup(domain, resolver), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function lookup(domain: string, r: MailResolver): Promise<MailDomainStatus> {
  try {
    const mx = await r.resolveMx(domain);
    // RFC 7505 "null MX" (a single MX with an empty host) declares the domain takes no mail.
    return mx.some((m) => m.exchange !== "") ? "ok" : "missing";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (code === "ENOTFOUND") return "missing";
    if (code !== "ENODATA") return "unknown";
  }
  // No MX record: mail goes to the domain's own address (implicit MX, RFC 5321 §5.1).
  const [a, aaaa] = await Promise.allSettled([r.resolve4(domain), r.resolve6(domain)]);
  if ([a, aaaa].some((x) => x.status === "fulfilled" && x.value.length > 0)) return "ok";
  const definite = [a, aaaa].every(
    (x) => x.status === "rejected" && NO_RECORD.has((x.reason as NodeJS.ErrnoException).code ?? ""),
  );
  return definite ? "missing" : "unknown";
}
