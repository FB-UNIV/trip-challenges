import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useRoutes } from "react-router-dom";
import { routes } from "../src/routes.js";

// MemoryRouter + useRoutes rather than a data router: the pages don't use loaders, and the
// data router builds Requests with jsdom's AbortSignal, which Node's fetch rejects.
function AppRoutes({ onLocation }: { onLocation: (path: string) => void }) {
  const loc = useLocation();
  onLocation(loc.pathname + loc.search);
  return useRoutes(routes);
}

/** Mount the real app routes at `path`; `location()` is where the app has navigated to. */
export function renderAt(path: string) {
  let current = path;
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes onLocation={(p) => { current = p; }} />
    </MemoryRouter>,
  );
  return { user, location: () => current, ...view };
}
