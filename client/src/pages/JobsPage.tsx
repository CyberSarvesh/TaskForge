import { useEffect, useState } from "react";
import { StatusMark } from "../components/StatusMark";
import { api, messageOf } from "../lib/api";
import { STATUS_LABEL, dateTime, displayStatus, shortId } from "../lib/format";
import { useLive } from "../lib/live";
import { openJob } from "../lib/router";
import type { Job } from "../lib/types";

export function JobsPage() {
  const { meta, snapshot } = useLive();
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  // One cursor per page visited, so Previous is just a pop.
  const [cursors, setCursors] = useState<string[]>([]);
  const [page, setPage] = useState<{ items: Job[]; nextCursor: string | null }>();
  const [error, setError] = useState("");
  const before = cursors.at(-1);

  useEffect(() => {
    let current = true;
    const params = new URLSearchParams({ limit: "25" });
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (search) params.set("search", search);
    if (before) params.set("before", before);
    api.jobs(params).then(
      (value) => {
        if (!current) return;
        setPage(value);
        setError("");
      },
      (failure) => current && setError(messageOf(failure)),
    );
    return () => {
      current = false;
    };
  }, [status, type, search, before, snapshot?.at]);

  const filter = (apply: () => void) => {
    apply();
    setCursors([]);
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Jobs</h1>
        <div className="filters">
          <label className="field">
            Job id
            <input
              type="search"
              placeholder="Starts with"
              maxLength={36}
              value={search}
              onChange={(e) => filter(() => setSearch(e.target.value.replace(/[^0-9a-f-]/gi, "")))}
            />
          </label>
          <label className="field">
            Status
            <select value={status} onChange={(e) => filter(() => setStatus(e.target.value))}>
              <option value="">Any status</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            Type
            <select value={type} onChange={(e) => filter(() => setType(e.target.value))}>
              <option value="">Any type</option>
              {meta?.types.map((item) => <option key={item.type} value={item.type}>{item.title}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="table-scroll">
        <table className="jobs">
          <thead>
            <tr>
              <th>Job</th><th>Type</th><th>Status</th><th>Priority</th>
              <th className="number">Attempts</th><th>Worker</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            {page?.items.map((job) => (
              <tr key={job.id} onClick={() => openJob(job.id)}>
                <td>
                  <button className="link" onClick={(e) => { e.stopPropagation(); openJob(job.id); }}>
                    <code>{shortId(job.id)}</code>
                  </button>
                </td>
                <td>{job.type}</td>
                <td><StatusMark status={displayStatus(job)} /></td>
                <td className={`priority ${job.priority}`}>{job.priority}</td>
                <td className="number">{job.attempts}/{job.max_attempts}</td>
                <td>{job.worker}</td>
                <td>{dateTime(job.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {page && !page.items.length && (
        <p className="empty">
          {status || type || search ? "No jobs match these filters." : "No jobs yet. Use New job to queue the first one."}
        </p>
      )}

      <div className="pager">
        <button className="button quiet" disabled={!cursors.length} onClick={() => setCursors(cursors.slice(0, -1))}>
          Newer
        </button>
        <button
          className="button quiet"
          disabled={!page?.nextCursor}
          onClick={() => page?.nextCursor && setCursors([...cursors, page.nextCursor])}
        >
          Older
        </button>
      </div>
    </section>
  );
}
