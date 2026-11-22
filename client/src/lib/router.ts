import { useMemo, useSyncExternalStore } from "react";

export const PAGES = ["floor", "jobs", "metrics", "engineering"] as const;
export type Page = (typeof PAGES)[number];

const subscribe = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};

const parse = (hash: string) => {
  const [path = "", search = ""] = hash.replace(/^#\/?/, "").split("?");
  const page: Page = PAGES.find((name) => name === path) ?? "floor";
  return { page, job: new URLSearchParams(search).get("job") };
};

export const useRoute = () => {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return useMemo(() => parse(hash), [hash]);
};

export const openJob = (id: string) => {
  location.hash = `/${parse(location.hash).page}?job=${id}`;
};

export const closeJob = () => {
  const route = parse(location.hash);
  if (route.job) location.hash = `/${route.page}`;
};
