/**
 * Theme controller (mandate §14): Dark | Light | System, persisted in
 * localStorage ("lumen.theme"), defaulting to System which respects
 * prefers-color-scheme. Dark is the product's primary identity; light is a
 * first-class token set, not an inversion. Applies `data-theme` on <html> and
 * keeps the meta theme-color in sync for mobile chrome.
 */
import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "dark" | "light" | "system";
const STORAGE_KEY = "lumen.theme";

function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

function systemPrefersLight(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
}

/** Resolve a preference to the concrete theme applied to the document. */
export function resolveTheme(preference: ThemePreference): "dark" | "light" {
  return preference === "system" ? (systemPrefersLight() ? "light" : "dark") : preference;
}

function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.setAttribute("data-theme", theme);
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = theme === "light" ? "#f7f6f3" : "#050607";
}

/** React hook: current preference + setter; applies and persists changes. */
export function useTheme(): { preference: ThemePreference; setPreference: (p: ThemePreference) => void } {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);

  useEffect(() => {
    applyTheme(resolveTheme(preference));
  }, [preference]);

  useEffect(() => {
    if (preference !== "system" || typeof matchMedia !== "function") return;
    const media = matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme(resolveTheme("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      // storage unavailable (private mode): keep in-memory only
    }
  }, []);

  return { preference, setPreference };
}
