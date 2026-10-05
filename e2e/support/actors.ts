// People in a test: teachers on a desktop browser, students on phones. Each actor gets
// its own browser context (own cookies), exactly like separate devices.
import { devices, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { WEB_URL } from "./env.js";
import { TeacherApi, StudentApi } from "./api.js";
import { waitForMail, linkIn, relative } from "./mail.js";

let n = 0;
/** Unique per run and per worker, so parallel specs never share an inbox or a trip. */
export const unique = (tag: string) =>
  `${tag}-${Date.now().toString(36)}-${process.pid}-${++n}-${Math.random().toString(36).slice(2, 6)}`;
export const uniqueEmail = (tag: string) => `${unique(tag)}@e2e.test`;

export type Teacher = { email: string; context: BrowserContext; page: Page; api: TeacherApi };
export type Student = { email: string; context: BrowserContext; page: Page; api: StudentApi };

export const ACCESS_CODE_SUBJECT = /^Your access code for /;

export async function signInTeacher(browser: Browser, email = uniqueEmail("teacher")): Promise<Teacher> {
  const context = await browser.newContext({ baseURL: WEB_URL });
  const res = await context.request.post("/api/auth/teacher/dev-login", { data: { email } });
  expect(res.ok(), await res.text()).toBe(true);
  return { email, context, page: await context.newPage(), api: new TeacherApi(context.request) };
}

export async function phoneContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ ...devices["Pixel 5"], baseURL: WEB_URL });
}

/** The join link from the latest access-code mail sent to `email`. */
export async function joinLinkFor(email: string): Promise<string> {
  return relative(linkIn(await waitForMail(email, { subject: ACCESS_CODE_SUBJECT }), "/join?code="));
}

/** Open the emailed join link on a phone, like a real student would. */
export async function joinByEmail(browser: Browser, email: string): Promise<Student> {
  const link = await joinLinkFor(email);
  const context = await phoneContext(browser);
  const page = await context.newPage();
  await page.goto(link);
  await expect(page).toHaveURL(/\/$/); // redeemed → home
  return { email, context, page, api: new StudentApi(context.request) };
}

/** Import `count` students into the trip and sign each one in from their email. */
export async function enrollStudents(browser: Browser, teacher: Teacher, tripId: string, count: number): Promise<Student[]> {
  const emails = Array.from({ length: count }, () => uniqueEmail("kid"));
  await teacher.api.importRoster(tripId, emails);
  return Promise.all(emails.map((e) => joinByEmail(browser, e)));
}

export async function closeAll(...actors: { context: BrowserContext }[]): Promise<void> {
  await Promise.all(actors.map((a) => a.context.close()));
}
