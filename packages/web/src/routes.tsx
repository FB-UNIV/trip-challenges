// The route table, shared by main.tsx (browser router) and the tests (memory router).
import type { RouteObject } from "react-router-dom";
import { App } from "./App.js";
import { StudentHome } from "./routes/StudentHome.js";
import { JoinPage } from "./routes/JoinPage.js";
import { TeamPage } from "./routes/TeamPage.js";
import { ChallengePage } from "./routes/ChallengePage.js";
import { ChallengesPage } from "./routes/ChallengesPage.js";
import { VoteHome } from "./routes/VoteHome.js";
import { VotePage } from "./routes/VotePage.js";
import { TeacherHome } from "./routes/teacher/TeacherHome.js";
import { TripLanding, TripLayout } from "./routes/teacher/TripLayout.js";
import { TripOverview } from "./routes/teacher/TripOverview.js";
import { TripChallenges } from "./routes/teacher/TripChallenges.js";
import { TripStudents } from "./routes/teacher/TripStudents.js";
import { TripReview } from "./routes/teacher/TripReview.js";
import { TripResults } from "./routes/teacher/TripResults.js";
import { TripSettings } from "./routes/teacher/TripSettings.js";
import { AcceptInvite } from "./routes/teacher/AcceptInvite.js";
import { Ceremony } from "./routes/Ceremony.js";
import { QrSheet } from "./routes/teacher/QrSheet.js";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <StudentHome /> },
      { path: "join", element: <JoinPage /> }, // ?code=... from the email link
      { path: "team", element: <TeamPage /> },
      { path: "challenges", element: <ChallengesPage /> }, // my checklist
      { path: "c/:qrSlug", element: <ChallengePage /> }, // QR target (and checklist rows)
      { path: "vote", element: <VoteHome /> },
      { path: "vote/:challengeId", element: <VotePage /> },
      { path: "teacher", element: <TeacherHome /> },
      { path: "teacher/accept", element: <AcceptInvite /> }, // ?token=... from invite email
      {
        path: "teacher/trips/:id",
        element: <TripLayout />,
        children: [
          { index: true, element: <TripLanding /> }, // overview, or results during the reveal
          { path: "overview", element: <TripOverview /> },
          { path: "challenges", element: <TripChallenges /> },
          { path: "students", element: <TripStudents /> },
          { path: "review", element: <TripReview /> },
          { path: "results", element: <TripResults /> },
          { path: "settings", element: <TripSettings /> },
        ],
      },
    ],
  },
  // Full-screen (outside the app chrome) — projected during the reveal.
  { path: "/ceremony/:id", element: <Ceremony /> },
  // Printable QR cards — also outside the chrome, so only the cards are printed.
  { path: "/qr/:id", element: <QrSheet /> },
];
