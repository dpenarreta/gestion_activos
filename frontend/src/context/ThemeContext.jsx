import { createContext, useCallback, useEffect, useState } from "react";

import { themeService } from "../api/themeService";
import { useAppearance } from "./AppearanceContext";

export const ThemeContext = createContext(null);

/**
 * Colores de marca que describen *superficies* (fondo de página y texto
 * sobre ella), a diferencia de los que describen la *identidad* (primario,
 * enlaces, botones).
 *
 * La distinción existe porque el tema institucional solo define una paleta,
 * pensada para fondo claro. Aplicarla también en modo oscuro pintaba la
 * página de blanco mientras los componentes de Bootstrap se dibujaban
 * oscuros: el texto secundario quedaba en un contraste de 1.30:1, muy por
 * debajo del 4.5:1 que exige WCAG AA. En oscuro estas tres se retiran y
 * gobiernan los tokens de `appearance-tokens.css`; los de identidad se
 * aplican siempre, porque un azul corporativo funciona sobre cualquier
 * fondo.
 */
const VARIABLES_DE_SUPERFICIE = {
  "--color-background": "color_background",
  "--color-text": "color_text",
  "--color-headings": "color_headings",
};

const VARIABLES_DE_IDENTIDAD = {
  "--color-primary": "color_primary",
  "--color-secondary": "color_secondary",
  "--color-links": "color_links",
  "--color-buttons": "color_buttons",
  "--color-menu": "color_menu",
};

function applyThemeToDocument(theme, resolvedTheme) {
  const root = document.documentElement.style;

  for (const [variable, campo] of Object.entries(VARIABLES_DE_IDENTIDAD)) {
    root.setProperty(variable, theme[campo]);
  }

  for (const [variable, campo] of Object.entries(VARIABLES_DE_SUPERFICIE)) {
    if (resolvedTheme === "dark") {
      // Quitarlas, no reasignarlas: un estilo inline gana sobre cualquier
      // regla CSS, así que dejarlas puestas impediría que
      // `:root[data-theme="dark"]` haga su trabajo.
      root.removeProperty(variable);
    } else {
      root.setProperty(variable, theme[campo]);
    }
  }

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
  const { resolvedTheme } = useAppearance();

  const refresh = useCallback(() => {
    setIsLoading(true);
    return themeService
      .getCurrent()
      .then((data) => {
        setTheme(data);
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

  // Reaplicar también cuando cambia claro/oscuro: el usuario puede alternar
  // el modo sin recargar, y las variables de superficie dependen de él.
  useEffect(() => {
    if (theme) {
      applyThemeToDocument(theme, resolvedTheme);
    }
  }, [theme, resolvedTheme]);

  return (
    <ThemeContext.Provider value={{ theme, isLoading, refresh }}>{children}</ThemeContext.Provider>
  );
}
