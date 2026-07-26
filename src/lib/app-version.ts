// Best-effort build identifier for triage.
export const APP_VERSION: string =
  (import.meta.env.VITE_APP_VERSION as string | undefined) ??
  (import.meta.env.MODE === "production" ? "prod" : "dev");
