import { useState } from "react";
import { Composer } from "./components/Composer";
import { JobDrawer } from "./components/JobDrawer";
import { useLive } from "./lib/live";
import { PAGES, useRoute } from "./lib/router";
import type { Page } from "./lib/router";
import { useTheme } from "./lib/theme";
import { EngineeringPage } from "./pages/EngineeringPage";
import { FloorPage } from "./pages/FloorPage";
import { JobsPage } from "./pages/JobsPage";
import { MetricsPage } from "./pages/MetricsPage";

const NAV: Record<Page, string> = {
  floor: "Floor",
  jobs: "Jobs",
  metrics: "Metrics",
  engineering: "Engineering",
};

export function App() {
  const { page, job } = useRoute();
  const { theme, toggle } = useTheme();
  const [composing, setComposing] = useState(false);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/floor">
          <img src="/favicon.svg" alt="" width="30" height="30" />
          TaskForge
        </a>
        <nav aria-label="Main">
          {PAGES.map((name) => (
            <a key={name} href={`#/${name}`} aria-current={page === name ? "page" : undefined}>
              {NAV[name]}
            </a>
          ))}
        </nav>
        <div className="topbar-actions">
          <button className="button quiet" onClick={toggle}>
            {theme === "day" ? "Night shift" : "Day shift"}
          </button>
          <button className="button primary" onClick={() => setComposing(true)}>New job</button>
        </div>
      </header>

      <SystemNotice />

      <main>
        {page === "floor" && <FloorPage theme={theme} />}
        {page === "jobs" && <JobsPage />}
        {page === "metrics" && <MetricsPage />}
        {page === "engineering" && <EngineeringPage />}
      </main>

      {composing && <Composer onClose={() => setComposing(false)} />}
      {job && <JobDrawer key={job} id={job} />}
    </div>
  );
}

function SystemNotice() {
  const { reachable, snapshot, streaming } = useLive();
  let message = "";
  if (!reachable) message = "Can't reach the API or its database. Retrying every 2 seconds.";
  else if (snapshot && !snapshot.redis.up) {
    message = "Redis is down. New jobs are still saved in Postgres and will be dispatched when it returns.";
  } else if (snapshot && !streaming) message = "Live stream interrupted. Showing updates every 2 seconds.";
  return <div className="notice" role="status">{message}</div>;
}
