import { useEffect, useState } from "react";

export type Theme = "day" | "night";
const KEY = "taskforge-shift";

const initial = (): Theme => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "day" || saved === "night") return saved;
  } catch {
    // Storage can be blocked; the system preference is a fine default.
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
};

export const useTheme = () => {
  const [theme, setTheme] = useState(initial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = () => {
    const next = theme === "day" ? "night" : "day";
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Not being able to remember the choice is harmless.
    }
  };
  return { theme, toggle };
};
