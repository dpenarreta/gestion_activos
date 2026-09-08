import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const UnsavedChangesContext = createContext(null);

const CONFIRM_MESSAGE = "Hay cambios sin guardar. ¿Desea continuar sin guardar?";

/**
 * Contexto único para todo `/admin/*` (montado por AdminLayout): rastrea si
 * hay cambios sin guardar en la vista actual y centraliza la confirmación
 * antes de navegar (sidebar, pestañas, o el cierre/recarga de la pestaña
 * del navegador vía `beforeunload`).
 */
export function UnsavedChangesProvider({ children }) {
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const navigate = useNavigate();

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (isDirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const guardedNavigate = useCallback(
    (to, options) => {
      if (isDirtyRef.current && !window.confirm(CONFIRM_MESSAGE)) {
        return;
      }
      setIsDirty(false);
      navigate(to, options);
    },
    [navigate]
  );

  return (
    <UnsavedChangesContext.Provider value={{ isDirty, setIsDirty, guardedNavigate }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error("useUnsavedChanges debe usarse dentro de un <UnsavedChangesProvider>.");
  }
  return context;
}
