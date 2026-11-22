import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/big-shoulders/index.css";
import "@fontsource-variable/hanken-grotesk/index.css";
import "./styles/base.css";
import "./styles/pages.css";
import "./styles/overlays.css";
import { App } from "./App";
import { ToastProvider } from "./components/Toasts";
import { LiveProvider } from "./lib/live";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <LiveProvider>
        <App />
      </LiveProvider>
    </ToastProvider>
  </StrictMode>,
);
