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
import { TripAdmin } from "./routes/teacher/TripAdmin.js";
import { AcceptInvite } from "./routes/teacher/AcceptInvite.js";
import { Ceremony } from "./routes/Ceremony.js";

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
      { path: "teacher/trips/:id", element: <TripAdmin /> },
    ],
  },
  // Full-screen (outside the app chrome) — projected during the reveal.
  { path: "/ceremony/:id", element: <Ceremony /> },
];
