import { Outlet, Link, useLocation } from "react-router-dom";
import { LightboxProvider } from "./ui.js";

function NavLink({ to, label }: { to: string; label: string }) {
  const { pathname } = useLocation();
  const active = pathname === to || pathname.startsWith(to + "/");
  return (
    <Link to={to} className={active ? "navlink active" : "navlink"}>{label}</Link>
  );
}

export function App() {
  const { pathname } = useLocation();
  const wide = pathname.startsWith("/teacher/trips/");
  return (
    <div className={wide ? "shell shell-wide" : "shell"}>
      <header className="appbar">
        <Link to="/" className="brand"><span className="medal">🏆</span> Trip Challenges</Link>
        <nav className="tabs">
          <NavLink to="/team" label="Team" />
          <NavLink to="/vote" label="Vote" />
          <NavLink to="/teacher" label="Teacher" />
        </nav>
      </header>
      <main>
        <LightboxProvider>
          <Outlet />
        </LightboxProvider>
      </main>
    </div>
  );
}
