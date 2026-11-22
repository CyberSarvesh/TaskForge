import { ThroughputChart } from "../components/ThroughputChart";
import { count, duration, time } from "../lib/format";
import { useLive } from "../lib/live";

export function MetricsPage() {
  const { snapshot } = useLive();
  if (!snapshot) return <section className="page"><p className="empty">Waiting for metrics</p></section>;

  const { series, latency, types, workers, redis, counts, windowSeconds, bucketSeconds } = snapshot;
  const completed = series.reduce((sum, point) => sum + point.completed, 0);
  const errors = series.reduce((sum, point) => sum + point.errors, 0);
  const attempts = completed + errors;
  const online = workers.filter((worker) => worker.online);
  const slots = online.reduce((sum, worker) => sum + worker.concurrency, 0);
  const busiest = Math.max(1, ...types.map((type) => type.completed));

  const headline = [
    ["Completed", count(completed)],
    ["Attempt success", attempts ? `${((completed / attempts) * 100).toFixed(1)}%` : "None yet"],
    ["Median wait", duration(latency.wait_p50)],
    ["Slots in use", `${Math.min(counts.processing, slots)} of ${slots}`],
  ];

  return (
    <section className="page">
      <div className="page-head">
        <h1>Metrics</h1>
        <p className="hint">Last {windowSeconds / 60} minutes, computed from the event log in Postgres.</p>
      </div>

      <dl className="headline-stats">
        {headline.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>

      <div className="metric-block">
        <h2>Throughput, per {bucketSeconds} seconds</h2>
        <ThroughputChart series={series} />
        <details>
          <summary>Show as a table</summary>
          <div className="table-scroll short">
            <table>
              <thead><tr><th>Time</th><th className="number">Completed</th><th className="number">Errors</th></tr></thead>
              <tbody>
                {series.slice(0, -1).reverse().map((point) => (
                  <tr key={point.t}>
                    <td>{time(point.t)}</td>
                    <td className="number">{point.completed}</td>
                    <td className="number">{point.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <div className="metric-columns">
        <div className="metric-block">
          <h2>Latency</h2>
          <table>
            <thead><tr><th>Stage</th><th className="number">p50</th><th className="number">p95</th></tr></thead>
            <tbody>
              <tr>
                <td>Waiting in queue</td>
                <td className="number">{duration(latency.wait_p50)}</td>
                <td className="number">{duration(latency.wait_p95)}</td>
              </tr>
              <tr>
                <td>Running</td>
                <td className="number">{duration(latency.run_p50)}</td>
                <td className="number">{duration(latency.run_p95)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="metric-block">
          <h2>Completed by type</h2>
          {!types.length && <p className="hint">Nothing completed in this window.</p>}
          <ul className="bars">
            {types.map((item) => (
              <li key={item.type} title={`Median run time ${duration(item.run_p50)}`}>
                <span>{item.type}</span>
                <div><i style={{ width: `${(item.completed / busiest) * 100}%` }} /></div>
                <b>{count(item.completed)}</b>
              </li>
            ))}
          </ul>
        </div>

        <div className="metric-block">
          <h2>Processes</h2>
          <table>
            <thead><tr><th>Name</th><th>State</th><th className="number">Load</th></tr></thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.id}>
                  <td>{worker.name}</td>
                  <td>{worker.online ? "Online" : "Down"}</td>
                  <td className="number">{worker.online ? `${worker.active.length}/${worker.concurrency}` : ""}</td>
                </tr>
              ))}
              <tr>
                <td>Redis index</td>
                <td>{redis.up ? "Online" : "Down"}</td>
                <td className="number">{redis.depth === null ? "" : `${count(redis.depth)} ready`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
