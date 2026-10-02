/**
 * Theme controller (mandate §14): Dark | Light | System, persisted in
 * localStorage ("lumen.theme"). Light is the product default: with no stored
 * value the app resolves to light, and the "system" preference never infers
 * dark from prefers-color-scheme (an explicit Dark choice is the only way to
 * get dark). An existing explicit choice is respected and never reset.
 * Applies `data-theme` on <html> and keeps the meta theme-color in sync for
 * mobile chrome. A matching pre-paint snippet in index.html applies the
 * attribute before React mounts so there is no flash of the wrong theme.
 */
import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "dark" | "light" | "system";
const STORAGE_KEY = "lumen.theme";

function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

/**
 * Resolve a preference to the concrete theme applied to the document.
 * Light is the default surface: only an explicit "dark" preference (or a
 * stored "dark" from before this default) applies dark. "system" resolves to
 * light — the OS preference is never used to infer dark.
 */
export function resolveTheme(preference: ThemePreference): "dark" | "light" {
  return preference === "dark" ? "dark" : "light";
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
