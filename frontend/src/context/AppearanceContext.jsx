import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  applyAppearanceTheme,
  readStoredAppearanceMode,
  resolveAppearanceTheme,
  writeStoredAppearanceMode,
} from "../utils/appearance";

const AppearanceContext = createContext(null);

/**
 * Sistema de apariencia claro/oscuro/sistema — independiente del
 * `ThemeContext` (colores de marca del sitio). El atributo `data-theme` ya
 * viene fijado antes del primer render por el script inline de
 * `index.html` (ver src/utils/appearance.js); este provider solo mantiene
 * el estado de React en sincronía y reacciona a cambios en vivo.
 */
export function AppearanceProvider({ children }) {
  const [mode, setModeState] = useState(() => readStoredAppearanceMode());
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveAppearanceTheme(mode));

  useEffect(() => {
    const nextResolved = resolveAppearanceTheme(mode);
    setResolvedTheme(nextResolved);
    applyAppearanceTheme(nextResolved);

    if (mode !== "system") {
      return undefined;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange(event) {
      const systemResolved = event.matches ? "dark" : "light";
      setResolvedTheme(systemResolved);
      applyAppearanceTheme(systemResolved);
    }
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [mode]);

  function setMode(nextMode) {
    writeStoredAppearanceMode(nextMode);
    setModeState(nextMode);
  }

  const value = useMemo(() => ({ mode, resolvedTheme, setMode }), [mode, resolvedTheme]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error("useAppearance debe usarse dentro de <AppearanceProvider>.");
  }
  return context;
}
