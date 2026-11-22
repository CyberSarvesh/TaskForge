import { useState } from "react";
import { useNotify } from "../components/Toasts";
import { FloorCanvas } from "../floor/FloorCanvas";
import { api, messageOf } from "../lib/api";
import { EVENT_LABEL, count, shortId, time } from "../lib/format";
import { useLive } from "../lib/live";
import { openJob } from "../lib/router";
import type { Theme } from "../lib/theme";
import type { Meta, Snapshot, Worker } from "../lib/types";

const headline = (snapshot: Snapshot | null) => {
  if (!snapshot) return "Opening the forge";
  const { pending, scheduled, processing } = snapshot.counts;
  const live = pending + scheduled + processing;
  if (!snapshot.workers.some((worker) => worker.online)) return "No workers on shift";
  return live ? `${count(live)} ${live === 1 ? "job" : "jobs"} in the forge` : "The forge is ready";
};

const explain = (snapshot: Snapshot | null, meta: Meta | null) => {
  if (!snapshot || !meta) return "Connecting to the queue.";
  if (snapshot.workers.some((worker) => !worker.online)) {
    return `A worker stopped. Its jobs return to the queue when their ${meta.leaseMs / 1000} second leases expire.`;
  }
  if (!snapshot.workers.length) return "Jobs are still accepted and saved. Start a worker and it will pick them up.";
  return meta.demo
    ? "Each ingot is a real job and each hammer a real process. Send in work, then kill a worker and watch nothing get lost."
    : "Each ingot is a real job and each hammer a real process. Select an ingot to see its history.";
};

export function FloorPage({ theme }: { theme: Theme }) {
  const { meta, snapshot, recent, refresh } = useLive();
  const notify = useNotify();
  const [starting, setStarting] = useState("");

  const runScenario = async (name: string) => {
    setStarting(name);
    try {
      await api.scenario(name);
      refresh();
    } catch (error) {
      notify(messageOf(error), "error");
    } finally {
      setStarting("");
    }
  };

  const crash = async (worker: Worker) => {
    try {
      await api.crash(worker.id);
      notify(`Killed ${worker.name} without cleanup. Watch the recovery.`);
      refresh();
    } catch (error) {
      notify(messageOf(error), "error");
    }
  };

  const counts = snapshot?.counts;
  const totals = [
    ["Queued", counts?.pending],
    ["Cooling", counts?.scheduled],
    ["Running", counts?.processing],
    ["Shipped", counts?.completed],
    ["Scrap", counts && counts.failed + counts.cancelled],
  ] as const;

  return (
    <section className="floor-page">
      <div className="floor-stage">
        <FloorCanvas theme={theme} onCrash={meta?.demo ? crash : null} />

        <div className="floor-intro">
          <h1>{headline(snapshot)}</h1>
          <p>{explain(snapshot, meta)}</p>
        </div>

        <div className="floor-side">
          <dl className="totals">
            {totals.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value === undefined ? "" : count(value)}</dd>
              </div>
            ))}
          </dl>
          <ol className="shift-log" aria-label="Latest events">
            {recent.slice(0, 5).map((event) => (
              <li key={event.id}>
                <button onClick={() => openJob(event.jobId)}>
                  <time>{time(event.at)}</time>
                  <span className={`log-kind ${event.kind}`}>{EVENT_LABEL[event.kind]}</span>
                  <code>{shortId(event.jobId)}</code>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {meta?.demo && (
        <div className="controls" aria-label="Demo scenarios">
          {meta.scenarios.map(({ name, title, description }) => (
            <button key={name} disabled={starting === name} onClick={() => runScenario(name)}>
              <strong>{title}</strong>
              <span>{description}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
