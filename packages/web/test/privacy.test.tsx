// The privacy page for students and families: reachable signed out, from every app screen.
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./server.js";
import { renderAt } from "./render.js";

describe("privacy page", () => {
  it("explains what is kept, who sees it and when it is erased — with no API call", async () => {
    renderAt("/confidentialite"); // unhandled requests fail the test: the page needs none
    expect(screen.getByRole("heading", { name: "Tes données et ta vie privée" })).toBeInTheDocument();
    for (const h of ["Ce que l'application garde", "Qui voit quoi", "Quand tout est effacé", "Tes droits"]) {
      expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "cnil.fr" })).toHaveAttribute("href", "https://www.cnil.fr");
  });

  it("says what stays on the phone: the session cookie and the decisions already announced", async () => {
    renderAt("/confidentialite");
    expect(screen.getByText(/Sur ton téléphone/)).toHaveTextContent(
      "Sur ton téléphone, l'application retient seulement les décisions de tes enseignants qu'elle t'a déjà annoncées",
    );
    expect(screen.getByText(/position GPS/)).toHaveTextContent("retirées sur ton téléphone avant l'envoi");
  });

  it("is linked from the app shell, even before signing in", async () => {
    server.use(
      http.get("/api/student/me", () => HttpResponse.json({}, { status: 401 })),
      http.get("/api/teams", () => HttpResponse.json({}, { status: 401 })),
    );
    const { user, location } = renderAt("/");
    await screen.findByText("Saisis ton code d'accès");
    await user.click(screen.getByRole("link", { name: "Tes données et ta vie privée" }));
    expect(location()).toBe("/confidentialite");
  });
});
