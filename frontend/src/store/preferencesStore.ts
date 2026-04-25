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

const THEME_CSS: Record<Theme, Record<string, string>> = {
  dark: {
    "--color-bg-base": "#0d1117",
    "--color-bg-subtle": "#161b22",
    "--color-bg-muted": "#21262d",
    "--color-border": "#30363d",
    "--color-border-muted": "#21262d",
    "--color-fg-default": "#e6edf3",
    "--color-fg-muted": "#8b949e",
    "--color-fg-subtle": "#6e7681",
    colorScheme: "dark",
  },
  middle: {
    "--color-bg-base": "#0d1421",
    "--color-bg-subtle": "#111929",
    "--color-bg-muted": "#1a2235",
    "--color-border": "#263047",
    "--color-border-muted": "#1a2235",
    "--color-fg-default": "#e8edf5",
    "--color-fg-muted": "#8fa3c0",
    "--color-fg-subtle": "#5d7a9a",
    colorScheme: "dark",
  },
  bright: {
    "--color-bg-base": "#ffffff",
    "--color-bg-subtle": "#f6f8fa",
    "--color-bg-muted": "#eaeef2",
    "--color-border": "#d0d7de",
    "--color-border-muted": "#eaeef2",
    "--color-fg-default": "#1f2328",
    "--color-fg-muted": "#656d76",
    "--color-fg-subtle": "#8b949e",
    colorScheme: "light",
  },
};

function applyTheme(theme: Theme) {
  const vars = THEME_CSS[theme];
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
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
      if (theme && THEME_CSS[theme]) applyTheme(theme);
    } catch { /* ignore */ }
  }
}
