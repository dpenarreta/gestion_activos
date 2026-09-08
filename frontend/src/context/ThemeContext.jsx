import { createContext, useCallback, useEffect, useState } from "react";

import { themeService } from "../api/themeService";

export const ThemeContext = createContext(null);

function applyThemeToDocument(theme) {
  const root = document.documentElement.style;
  root.setProperty("--color-primary", theme.color_primary);
  root.setProperty("--color-secondary", theme.color_secondary);
  root.setProperty("--color-background", theme.color_background);
  root.setProperty("--color-headings", theme.color_headings);
  root.setProperty("--color-text", theme.color_text);
  root.setProperty("--color-links", theme.color_links);
  root.setProperty("--color-buttons", theme.color_buttons);
  root.setProperty("--color-menu", theme.color_menu);
  root.setProperty("--font-primary", theme.font_primary_css);
  root.setProperty("--font-secondary", theme.font_secondary_css);
  root.setProperty("--font-size-base", `${theme.font_size_base}px`);
  root.setProperty("--border-radius", theme.border_radius_css);

  document.title = theme.site_name;

  if (theme.favicon_url) {
    let iconLink = document.querySelector("link[rel~='icon']");
    if (!iconLink) {
      iconLink = document.createElement("link");
      iconLink.rel = "icon";
      document.head.appendChild(iconLink);
    }
    iconLink.href = theme.favicon_url;
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(() => {
    setIsLoading(true);
    return themeService
      .getCurrent()
      .then((data) => {
        setTheme(data);
        applyThemeToDocument(data);
        return data;
      })
      .catch(() => {
        // Si el tema no pudo cargarse, se conservan los valores por
        // defecto ya aplicados por src/main.jsx (env.appName) y por
        // variables.css.
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ThemeContext.Provider value={{ theme, isLoading, refresh }}>{children}</ThemeContext.Provider>
  );
}
