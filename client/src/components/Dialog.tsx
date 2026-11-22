import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
}

/** Native <dialog>, which brings focus trapping, Escape and an inert background with it. */
export function Dialog({ title, className, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="button quiet" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
