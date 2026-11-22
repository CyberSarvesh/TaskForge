import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import type { LiveEvent, Meta, Snapshot } from "./types";

const POLL_MS = 2000;
const MIN_GAP_MS = 700;
const LOG_LENGTH = 40;

type Listener = (event: LiveEvent) => void;

interface Live {
  meta: Meta | null;
  snapshot: Snapshot | null;
  recent: LiveEvent[];
  reachable: boolean;
  streaming: boolean;
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
  const listeners = useRef(new Set<Listener>());
  const refreshRef = useRef(() => {});

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    let inFlight = false;
    let again = false;
    let lastStart = 0;
    let haveMeta = false;

    const load = async () => {
      inFlight = true;
      again = false;
      lastStart = performance.now();
      try {
        if (!haveMeta) {
          const value = await api.meta();
          haveMeta = true;
          if (!disposed) setMeta(value);
        }
        const requestedAt = performance.now();
        const value = await api.snapshot();
        if (disposed) return;
        setSnapshot({ ...value, requestedAt });
        setReachable(true);
      } catch {
        if (!disposed) setReachable(false);
      } finally {
        inFlight = false;
        if (!disposed) schedule(again ? MIN_GAP_MS : POLL_MS);
      }
    };

    const schedule = (gap: number) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void load(), Math.max(0, lastStart + gap - performance.now()));
    };

    const refresh = () => {
      if (inFlight) again = true;
      else schedule(MIN_GAP_MS);
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

    const source = new EventSource("/api/events");
    source.addEventListener("resync", () => {
      setStreaming(true);
      refresh();
    });
    source.addEventListener("job", (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
      for (const listener of listeners.current) listener(event);
      buffer.push(event);
      if (buffer.length > LOG_LENGTH) buffer.shift();
      frame ||= requestAnimationFrame(flush);
      refresh();
    });
    source.onerror = () => setStreaming(false);

    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      source.close();
    };
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);
  const refresh = useCallback(() => refreshRef.current(), []);

  const value = useMemo(
    () => ({ meta, snapshot, recent, reachable, streaming, subscribe, refresh }),
    [meta, snapshot, recent, reachable, streaming, subscribe, refresh],
  );
  return <LiveContext value={value}>{children}</LiveContext>;
}

export const useLive = () => {
  const live = use(LiveContext);
  if (!live) throw new Error("useLive must be used inside LiveProvider");
  return live;
};
