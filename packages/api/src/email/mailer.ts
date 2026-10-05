// SMTP mailer for Access Codes + Erasure warnings. In dev (no SMTP configured),
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
    // Dev fallback. Do not enable in production.
    console.log(`[mail:dev] to=${to} :: ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: config.SMTP_FROM, to, subject, text });
}

export async function sendAccessCode(to: string, tripName: string, joinUrl: string): Promise<void> {
  await sendMail(
    to,
    `Your access code for ${tripName}`,
    `Open this link on your phone to join "${tripName}":\n\n${joinUrl}\n\n` +
      `This link is personal — please don't share it.`,
  );
}

export async function sendCoTeacherInvite(to: string, tripName: string, acceptUrl: string): Promise<void> {
  await sendMail(
    to,
    `You've been invited to co-manage ${tripName}`,
    `You've been added as a co-teacher for "${tripName}".\n\n` +
      `Sign in and accept here:\n\n${acceptUrl}\n\n` +
      `This invite is personal and expires in 7 days.`,
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
    `ACTION NEEDED: erasure failed for ${tripName}`,
    `Erasing the student data for "${tripName}" (trip ${tripId}) failed:\n\n${detail}\n\n` +
      `It is retried automatically every minute. If this keeps happening, check Vault, ` +
      `the object store and the API logs: until erasure completes, the data still exists.`,
  );
}

export async function sendErasureWarning(to: string, tripName: string, when: Date): Promise<void> {
  await sendMail(
    to,
    `Data for ${tripName} will be erased`,
    `All photos and student data for "${tripName}" will be permanently erased on ` +
      `${when.toISOString()}. This cannot be undone.`,
  );
}
