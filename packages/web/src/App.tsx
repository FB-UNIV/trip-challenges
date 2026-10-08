import { Outlet, Link, useLocation } from "react-router-dom";
import type { StudentChallenge } from "@trip/shared";
import { api, type Me } from "./api.js";
import { ConfirmProvider, LightboxProvider, TabBar, useAsync, type Tab } from "./ui.js";
import { canVote } from "./routes/vote-progress.js";

// Student screens get the bottom tab bar; teacher screens and /join never do.
const STUDENT_PAGE = /^\/(team|challenges|vote|c)?(\/|$)/;

export function App() {
  const { pathname } = useLocation();
  const wide = pathname.startsWith("/teacher/trips/");
  const shell = useStudentShell(pathname);
  const tabs = shell ? studentTabs(shell.me, shell.challenges) : null;
  return (
    <div className={["shell", wide && "shell-wide", tabs && "has-tabbar"].filter(Boolean).join(" ")}>
      <header className="appbar">
        <Link to="/" className="brand"><span className="medal">🏆</span> Trip Challenges</Link>
        {!tabs && (
          <nav className="tabs">
            <Link to="/teacher" className={pathname.startsWith("/teacher") ? "navlink active" : "navlink"}>Teacher</Link>
          </nav>
        )}
      </header>
      <main>
        <LightboxProvider>
          <ConfirmProvider>
            <Outlet />
          </ConfirmProvider>
        </LightboxProvider>
      </main>
      {tabs && <TabBar tabs={tabs} />}
    </div>
  );
}

/** Who's signed in (and their progress, for badges) — re-checked on every student screen. */
function useStudentShell(pathname: string) {
  const onStudentPage = STUDENT_PAGE.test(pathname);
  const { data } = useAsync(async () => {
    if (!onStudentPage) return null;
    const me = await api.me().catch(() => null);
    if (!me) return null;
    // Badges are a nice-to-have: the tab bar works without them.
    const list = await api.myChallenges().catch(() => null);
    return { me, challenges: list?.challenges ?? [] };
  }, [pathname]);
  return onStudentPage ? data : null;
}

function studentTabs(me: Me, challenges: StudentChallenge[]): Tab[] {
  const beforeVoting = me.phase === "draft" || me.phase === "challenge";
  const toEnter = me.phase === "challenge" && me.teamId ? challenges.filter((c) => !c.nominated).length : 0;
  const toVote = me.phase === "voting" ? challenges.filter(canVote).length : 0;
  return [
    { to: "/", label: "Home", icon: "🏠" },
    { to: "/challenges", label: "Challenges", icon: "📸", badge: toEnter, also: ["/c"] },
    { to: "/team", label: "Team", icon: "🧑‍🤝‍🧑", badge: me.phase === "draft" && !me.teamId ? 1 : 0 },
    { to: "/vote", label: "Vote", icon: "⚖️", badge: toVote, disabled: beforeVoting },
  ];
}
