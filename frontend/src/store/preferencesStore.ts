import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "bright" | "middle";
export type Language = "en" | "he";

interface PreferencesState {
  theme: Theme;
  language: Language;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: Language) => void;
}

/**
 * Theme handling — design pivot v2 collapses the previous dark/middle/bright
 * variants into a single dark palette defined in index.css :root. The picker
 * is preserved for future light mode reintroduction; for now all 3 values
 * resolve to the same look. data-theme attribute stays for [data-theme]
 * selector hooks if needed later.
 */
const THEME_COLOR_SCHEME: Record<Theme, "dark" | "light"> = {
  dark: "dark",
  middle: "dark",
  bright: "dark",
};

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  // Clear any legacy inline overrides written by previous versions of the app
  // so the :root tokens in index.css are the single source of truth.
  const LEGACY_VARS = [
    "--color-bg-base", "--color-bg-subtle", "--color-bg-muted",
    "--color-border", "--color-border-muted",
    "--color-fg-default", "--color-fg-muted", "--color-fg-subtle",
  ];
  for (const name of LEGACY_VARS) {
    root.style.removeProperty(name);
  }
  root.style.colorScheme = THEME_COLOR_SCHEME[theme];
  root.setAttribute("data-theme", theme);
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "dark",
      language: "en",
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setLanguage: (language) => {
        document.documentElement.setAttribute("dir", language === "he" ? "rtl" : "ltr");
        document.documentElement.setAttribute("lang", language);
        set({ language });
      },
    }),
    {
      name: "preferences-storage",
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme);
          document.documentElement.setAttribute("dir", state.language === "he" ? "rtl" : "ltr");
          document.documentElement.setAttribute("lang", state.language ?? "en");
        }
      },
    }
  )
);

// Apply theme on first load
if (typeof document !== "undefined") {
  const stored = localStorage.getItem("preferences-storage");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const theme = parsed?.state?.theme as Theme | undefined;
      if (theme && THEME_COLOR_SCHEME[theme]) applyTheme(theme);
    } catch { /* ignore */ }
  }
}
