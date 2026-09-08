/**
 * Lógica de resolución de apariencia (claro/oscuro/sistema), compartida
 * entre el script anti-flash de index.html (JS plano, sin imports) y
 * `AppearanceContext.jsx`. Ambos deben quedar deliberadamente idénticos en
 * comportamiento.
 */

export const APPEARANCE_STORAGE_KEY = "admin.appearance.mode";

export const APPEARANCE_MODES = ["light", "dark", "system"];

export function readStoredAppearanceMode() {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return APPEARANCE_MODES.includes(stored) ? stored : "system";
  } catch {
    // localStorage puede fallar (modo privado, cuota, contexto sin storage).
    return "system";
  }
}

export function writeStoredAppearanceMode(mode) {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, mode);
  } catch {
    // Sin persistencia disponible: el modo sigue aplicándose en memoria.
  }
}

export function prefersSystemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveAppearanceTheme(mode) {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return prefersSystemDark() ? "dark" : "light";
}

export function applyAppearanceTheme(resolvedTheme) {
  document.documentElement.setAttribute("data-theme", resolvedTheme);
  document.documentElement.setAttribute("data-bs-theme", resolvedTheme);
}
