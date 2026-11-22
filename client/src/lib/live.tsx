import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import type { LiveEvent, Meta, Snapshot } from "./types";

const POLL_MS = 2000;
const MIN_GAP_MS = 700;
// The public demo lives on a small bandwidth allowance, and every request also keeps the host awake.
const PUBLIC_QUIET_POLL_MS = 10_000;
const PUBLIC_MIN_GAP_MS = 2000;
const PUBLIC_IDLE_MS = 5 * 60_000;
const STREAM_RETRY_MS = 5000;
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
const LOG_LENGTH = 40;

type Listener = (event: LiveEvent) => void;

interface Live {
  meta: Meta | null;
  snapshot: Snapshot | null;
  recent: LiveEvent[];
  reachable: boolean;
  streaming: boolean;
  paused: boolean;
  subscribe: (listener: Listener) => () => void;
  refresh: () => void;
}

const LiveContext = createContext<Live | null>(null);

/*
 * Events give immediacy and snapshots give truth. Every event reaches subscribers straight away
 * (the floor animates from them), while React state is updated at most once per animation frame,
 * so a burst of a thousand events is a single render.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [recent, setRecent] = useState<LiveEvent[]>([]);
  const [reachable, setReachable] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const listeners = useRef(new Set<Listener>());
  const refreshRef = useRef(() => {});

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let inFlight = false;
    let again = false;
    let lastStart = 0;
    let haveMeta = false;
    let publicDemo = false;
    let stopped = true;
    let streamOpen = false;
    let quiet = false;
    let source: EventSource | undefined;
    let streamTimer = 0;
    let idleTimer = 0;

    const load = async () => {
      clearTimeout(timer);

      inFlight = true;
      again = false;
      lastStart = performance.now();
      try {
        if (!haveMeta) {
          const value = await api.meta();
          haveMeta = true;
          publicDemo = value.publicDemo;
          if (disposed) return;
          setMeta(value);
          watchForIdle();
        }
        const sentAt = performance.now();
        const { ageMs = 0, ...value } = await api.snapshot();
        if (disposed) return;
        const { pending, scheduled, processing } = value.counts;
        quiet = pending + scheduled + processing === 0 && value.workers.every((worker) => worker.online);
        // A shared snapshot may predate the request, and events since then must win over it.
        setSnapshot({ ...value, requestedAt: sentAt - ageMs });
        setReachable(true);
      } catch {
        if (!disposed) setReachable(false);
      } finally {
        inFlight = false;
        if (!disposed && !stopped) schedule(again ? minGap() : pollGap());
      }
    };

    const minGap = () => (publicDemo ? PUBLIC_MIN_GAP_MS : MIN_GAP_MS);
    const pollGap = () => (publicDemo && quiet && streamOpen ? PUBLIC_QUIET_POLL_MS : POLL_MS);

    const schedule = (gap: number) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void load(), Math.max(0, lastStart + gap - performance.now()));
    };

    const refresh = () => {
      if (stopped) return;
      if (inFlight) again = true;
      else schedule(minGap());
    };
    refreshRef.current = refresh;

    let buffer: LiveEvent[] = [];
    let frame = 0;
    const flush = () => {
      frame = 0;
      const batch = buffer.reverse();
      buffer = [];
      setRecent((previous) => [...batch, ...previous].slice(0, LOG_LENGTH));
    };

    const openStream = () => {
      const stream = new EventSource("/api/events");
      source = stream;
      stream.addEventListener("resync", () => {
        streamOpen = true;
        setStreaming(true);
        refresh();
      });
      stream.addEventListener("job", (message) => {
        const event = JSON.parse(message.data) as LiveEvent;
        for (const listener of listeners.current) listener(event);
        buffer.push(event);
        if (buffer.length > LOG_LENGTH) buffer.shift();
        frame ||= requestAnimationFrame(flush);
        refresh();
      });
      stream.onerror = () => {
        streamOpen = false;
        setStreaming(false);
        // EventSource gives up for good on any non-200, such as a 502 while the host restarts.
        if (stream.readyState === EventSource.CLOSED) streamTimer = window.setTimeout(openStream, STREAM_RETRY_MS);
      };
    };

    const pause = () => {
      if (stopped) return;
      stopped = true;
      streamOpen = false;
      source?.close();
      clearTimeout(timer);
      clearTimeout(streamTimer);
      setStreaming(false);
      setPaused(true);
    };

    const resume = () => {
      if (!stopped || document.hidden) return;
      stopped = false;
      setPaused(false);
      openStream();
      if (inFlight) again = true;
      else void load();
    };

    const watchForIdle = () => {
      clearTimeout(idleTimer);
      if (publicDemo) idleTimer = window.setTimeout(pause, PUBLIC_IDLE_MS);
    };

    const onActivity = () => {
      watchForIdle();
      resume();
    };

    const onVisibility = () => {
      if (document.hidden) pause();
      else onActivity();
    };

    document.addEventListener("visibilitychange", onVisibility);
    for (const name of ACTIVITY) window.addEventListener(name, onActivity, { passive: true });
    if (document.hidden) setPaused(true);
    else resume();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      for (const name of ACTIVITY) window.removeEventListener(name, onActivity);
      clearTimeout(timer);
      clearTimeout(streamTimer);
      clearTimeout(idleTimer);
      cancelAnimationFrame(frame);
      source?.close();
    };
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);
  const refresh = useCallback(() => refreshRef.current(), []);

  const value = useMemo(
    () => ({ meta, snapshot, recent, reachable, streaming, paused, subscribe, refresh }),
    [meta, snapshot, recent, reachable, streaming, paused, subscribe, refresh],
  );
  return <LiveContext value={value}>{children}</LiveContext>;
}

export const useLive = () => {
  const live = use(LiveContext);
  if (!live) throw new Error("useLive must be used inside LiveProvider");
  return live;
};
