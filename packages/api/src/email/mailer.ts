// SMTP mailer for Access Codes + Erasure warnings, in French (the app is for French schools). In dev (no SMTP configured),
// messages are logged instead of sent. NEVER log the code in production.
import nodemailer from "nodemailer";
import { config } from "../config.js";

const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    })
  : null;

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!transport) {
    // The dev fallback prints the whole mail (access codes, emails). In production that
    // would put minors' PII and live credentials in the logs, so fail instead (#20).
    if (config.NODE_ENV === "production") {
      throw new Error("SMTP is not configured (SMTP_HOST unset); refusing to print mail in production");
    }
    console.log(`[mail:dev] to=${to} :: ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: config.SMTP_FROM, to, subject, text });
}

export async function sendAccessCode(to: string, tripName: string, joinUrl: string): Promise<void> {
  await sendMail(
    to,
    `Ton code d'accès pour ${tripName}`,
    `Ouvre ce lien sur ton téléphone pour rejoindre « ${tripName} » :\n\n${joinUrl}\n\n` +
      `Ce lien est personnel — ne le partage avec personne.`,
  );
}

export async function sendCoTeacherInvite(to: string, tripName: string, acceptUrl: string): Promise<void> {
  await sendMail(
    to,
    `Invitation à co-gérer ${tripName}`,
    `Tu as été ajouté comme co-enseignant de « ${tripName} ».\n\n` +
      `Connecte-toi et accepte ici :\n\n${acceptUrl}\n\n` +
      `Cette invitation est personnelle et expire dans 7 jours.`,
  );
}

export async function sendErasureFailedAlert(
  to: string,
  tripName: string,
  tripId: string,
  detail: string,
): Promise<void> {
  await sendMail(
    to,
    `ACTION REQUISE : échec de l'effacement de ${tripName}`,
    `L'effacement des données des élèves de « ${tripName} » (sortie ${tripId}) a échoué :\n\n${detail}\n\n` +
      `Il est relancé automatiquement chaque minute. Si l'échec persiste, vérifie Vault, ` +
      `le stockage objet et les journaux de l'API : tant que l'effacement n'a pas abouti, les données existent encore.`,
  );
}

export async function sendErasureWarning(to: string, tripName: string, when: Date): Promise<void> {
  await sendMail(
    to,
    `Les données de ${tripName} vont être effacées`,
    `Toutes les photos et données des élèves de « ${tripName} » seront définitivement effacées le ` +
      `${frenchDate(when)} (heure de Paris). C'est irréversible.`,
  );
}

// « lundi 12 octobre 2026 à 14:00 » — the schools are in France.
const frenchDate = (d: Date) =>
  d.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Paris" });
