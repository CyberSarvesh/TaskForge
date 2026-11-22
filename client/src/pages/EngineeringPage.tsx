import { useState } from "react";
import { failureCases, tradeoffs } from "./engineeringContent";

export function EngineeringPage() {
  const [selected, setSelected] = useState(0);
  const current = failureCases[selected]!;

  return (
    <section className="page engineering">
      <div className="page-head">
        <h1>Built to be interrupted</h1>
        <p className="lede">
          Postgres holds the truth. Redis is a fast index that can be rebuilt at any moment. Workers only
          borrow jobs, for as long as they keep proving they are alive.
        </p>
      </div>

      <h2>What happens when&hellip;</h2>
      <div className="cases">
        <ul className="case-list">
          {failureCases.map((item, index) => (
            <li key={item.question}>
              <button aria-pressed={index === selected} onClick={() => setSelected(index)}>{item.question}</button>
            </li>
          ))}
        </ul>
        <article className="case" aria-live="polite">
          <h3>{current.answer}</h3>
          {current.detail.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <pre>{current.code}</pre>
          <p className="source">Source: <code>{current.source}</code></p>
        </article>
      </div>

      <h2>Deliberate trade-offs</h2>
      <dl className="tradeoffs">
        {tradeoffs.map(([choice, cost]) => (
          <div key={choice}><dt>{choice}</dt><dd>{cost}</dd></div>
        ))}
      </dl>

      <footer className="credit">
        TaskForge by Sarvesh Mohite.{" "}
        <a href="https://github.com/CyberSarvesh/TaskForge" target="_blank" rel="noreferrer">Source on GitHub</a>
      </footer>
    </section>
  );
}
