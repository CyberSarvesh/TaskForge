import { createContext, use, useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";

type Notify = (text: string, tone?: "info" | "error") => void;
const ToastContext = createContext<Notify>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; text: string; tone: string }[]>([]);
  const next = useRef(0);

  const notify = useCallback<Notify>((text, tone = "info") => {
    const id = next.current++;
    setToasts((current) => [...current.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 5000);
  }, []);

  return (
    <ToastContext value={notify}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map(({ id, text, tone }) => (
          <p key={id} className={`toast ${tone}`}>{text}</p>
        ))}
      </div>
    </ToastContext>
  );
}

export const useNotify = () => use(ToastContext);
