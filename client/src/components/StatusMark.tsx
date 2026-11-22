import { STATUS_LABEL } from "../lib/format";
import type { DisplayStatus } from "../lib/types";

// A different shape for each state, so colour is never the only signal.
const SHAPE: Record<DisplayStatus, string> = {
  pending: "M2 4h10v6H2z",
  scheduled: "M7 1a6 6 0 1 0 0 12A6 6 0 0 0 7 1Zm1 2.5V7l2 1.5-1 1.3-3-2.2V3.5Z",
  processing: "M3 1.5 12.5 7 3 12.5z",
  completed: "m1 7.5 2-2 2.5 2.5L11 2l2 2-7.5 8z",
  failed: "m2 4 2-2 3 3 3-3 2 2-3 3 3 3-2 2-3-3-3 3-2-2 3-3z",
  cancelled: "M2 5.5h10v3H2z",
};

export function StatusMark({ status }: { status: DisplayStatus }) {
  return (
    <span className={`status ${status}`}>
      <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
        <path d={SHAPE[status]} />
      </svg>
      {STATUS_LABEL[status]}
    </span>
  );
}
