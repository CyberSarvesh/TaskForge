import { useState } from "react";
import type { FormEvent } from "react";
import { api, messageOf } from "../lib/api";
import { useLive } from "../lib/live";
import type { Field, Priority } from "../lib/types";
import { Dialog } from "./Dialog";
import { useNotify } from "./Toasts";

type Values = Record<string, string | boolean>;

const defaults = (fields: Field[]): Values =>
  Object.fromEntries(
    fields.map((field) => [field.name, typeof field.default === "boolean" ? field.default : String(field.default)]),
  );

export function Composer({ onClose }: { onClose: () => void }) {
  const { meta, refresh } = useLive();
  const notify = useNotify();
  const [type, setType] = useState(meta?.types[0]?.type ?? "");
  const [edited, setEdited] = useState<Record<string, Values>>({});
  const [priority, setPriority] = useState<Priority>("normal");
  const [delay, setDelay] = useState("0");
  const [attempts, setAttempts] = useState("3");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const definition = meta?.types.find((item) => item.type === type) ?? meta?.types[0];
  if (!definition) {
    return (
      <Dialog title="New job" className="composer" onClose={onClose}>
        <p>The API isn't reachable, so the job types can't be loaded yet.</p>
      </Dialog>
    );
  }

  const values = { ...defaults(definition.fields), ...edited[definition.type] };
  const payload = Object.fromEntries(
    definition.fields.map(({ name, kind }) => [name, kind === "number" ? Number(values[name]) : values[name]]),
  );
  const body = {
    type: definition.type,
    payload,
    priority,
    maxAttempts: Number(attempts),
    delayMs: Math.round(Number(delay) * 1000),
  };

  const edit = (name: string, value: string | boolean) =>
    setEdited((all) => ({ ...all, [definition.type]: { ...all[definition.type], [name]: value } }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      const { job } = await api.create(body);
      notify(`Queued ${job.type} job ${job.id.slice(0, 8)}.`);
      refresh();
      onClose();
    } catch (failure) {
      setError(messageOf(failure));
      setSending(false);
    }
  };

  return (
    <Dialog title="New job" className="composer" onClose={onClose}>
      <div className="composer-grid">
        <form onSubmit={submit}>
          <fieldset className="type-picker">
            <legend>Type</legend>
            {meta!.types.map((item) => (
              <label key={item.type}>
                <input
                  type="radio"
                  name="type"
                  checked={item.type === definition.type}
                  onChange={() => setType(item.type)}
                />
                {item.title}
              </label>
            ))}
          </fieldset>
          <p className="hint">{definition.description}</p>

          {definition.fields.map(({ name, label, kind, min, max, locked }) =>
            kind === "boolean" ? (
              <label className="check" key={`${definition.type}.${name}`}>
                <input type="checkbox" checked={values[name] === true} onChange={(e) => edit(name, e.target.checked)} />
                {label}
              </label>
            ) : (
              <label className="field" key={`${definition.type}.${name}`}>
                {label}
                <input
                  type={kind}
                  required
                  min={min}
                  max={max}
                  readOnly={locked}
                  value={String(values[name])}
                  onChange={(e) => edit(name, e.target.value)}
                />
              </label>
            ),
          )}

          {definition.fields.some((field) => field.locked) && (
            <p className="hint">Text is fixed in the public demo, because every visitor can see every job.</p>
          )}

          <div className="field-row">
            <label className="field">
              Priority
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="field">
              Delay (seconds)
              <input type="number" required min="0" max={meta!.publicDemo ? 60 : 604800} value={delay} onChange={(e) => setDelay(e.target.value)} />
            </label>
            <label className="field">
              Max attempts
              <input type="number" required min="1" max={meta!.publicDemo ? 5 : 20} value={attempts} onChange={(e) => setAttempts(e.target.value)} />
            </label>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary wide" disabled={sending}>{sending ? "Queueing" : "Queue job"}</button>
        </form>

        <div className="request-preview">
          <h3>The request this sends</h3>
          <pre>{`POST /api/jobs\nContent-Type: application/json\n\n${JSON.stringify(body, null, 2)}`}</pre>
          <p className="hint">Add an Idempotency-Key header to make client retries safe.</p>
        </div>
      </div>
    </Dialog>
  );
}
