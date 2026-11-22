import { useEffect, useState } from "react";
import { api, messageOf } from "../lib/api";
import { EVENT_LABEL, dateTime, displayStatus, duration, time } from "../lib/format";
import { useLive } from "../lib/live";
import { closeJob } from "../lib/router";
import type { HistoryEvent, Job } from "../lib/types";
import { Dialog } from "./Dialog";
import { StatusMark } from "./StatusMark";
import { useNotify } from "./Toasts";

export function JobDrawer({ id }: { id: string }) {
  const { subscribe, refresh } = useLive();
  const notify = useNotify();
  const [data, setData] = useState<{ job: Job; events: HistoryEvent[] }>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribe((event) => event.jobId === id && setVersion((v) => v + 1)), [id, subscribe]);

  useEffect(() => {
    let current = true;
    api.job(id).then(
      (value) => {
        if (!current) return;
        setData(value);
        setError("");
      },
      (failure) => current && setError(messageOf(failure)),
    );
    return () => {
      current = false;
    };
  }, [id, version]);

  const act = async (action: "cancel" | "retry") => {
    setBusy(true);
    try {
      await api[action](id);
      refresh();
    } catch (failure) {
      notify(messageOf(failure), "error");
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  };

  const job = data?.job;
  return (
    <Dialog title={job ? `${job.type} job` : "Job"} className="drawer" onClose={closeJob}>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!job && !error && <p className="hint">Loading job</p>}
      {job && (
        <>
          <code className="job-id">{job.id}</code>
          <div className="drawer-state">
            <StatusMark status={displayStatus(job)} />
            {(job.status === "pending" || job.status === "processing") && (
              <button className="button danger" disabled={busy} onClick={() => act("cancel")}>Cancel job</button>
            )}
            {(job.status === "failed" || job.status === "cancelled") && (
              <button className="button primary" disabled={busy} onClick={() => act("retry")}>Run again</button>
            )}
          </div>

          <dl className="facts">
            <div><dt>Priority</dt><dd>{job.priority}</dd></div>
            <div><dt>Attempts</dt><dd>{job.attempts} of {job.max_attempts}</dd></div>
            <div><dt>Worker</dt><dd>{job.worker ?? "Not picked up"}</dd></div>
            <div><dt>Created</dt><dd>{dateTime(job.created_at)}</dd></div>
          </dl>

          {job.error && job.status !== "completed" && <p className="form-error">{job.error}</p>}

          <h3>History</h3>
          <ol className="timeline">
            {data.events.map((event) => (
              <li key={event.id} className={event.kind}>
                <time>{time(event.at)}</time>
                <div>
                  <strong>{EVENT_LABEL[event.kind]}</strong>
                  <span>
                    {[
                      event.worker,
                      event.attempt ? `attempt ${event.attempt}` : "",
                      event.wait_ms !== null ? `waited ${duration(event.wait_ms)}` : "",
                      event.run_ms !== null ? `ran ${duration(event.run_ms)}` : "",
                    ].filter(Boolean).join(", ")}
                  </span>
                  {event.detail && <em>{event.detail}</em>}
                </div>
              </li>
            ))}
          </ol>

          <h3>Payload</h3>
          <pre>{JSON.stringify(job.payload, null, 2)}</pre>
          {job.result !== null && (
            <>
              <h3>Result</h3>
              <pre>{JSON.stringify(job.result, null, 2)}</pre>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
