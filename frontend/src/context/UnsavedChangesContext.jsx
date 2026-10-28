import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { confirmarDescarte } from "../components/common/ConfirmarDescarte/confirmarDescarte";

const UnsavedChangesContext = createContext(null);

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
  // Una pantalla que no lleva un estado «sucio» sino que lo calcula (el
  // editor de dashboards) registra aquí la función que lo dice (auditoría
  // UX/UI, fase 3).
  const verificador = useRef(null);
  const registrarVerificador = useCallback((funcion) => {
    verificador.current = funcion;
    return () => {
      if (verificador.current === funcion) verificador.current = null;
    };
  }, []);
  const haySinGuardar = () =>
    isDirtyRef.current || Boolean(verificador.current?.());

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (haySinGuardar()) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const guardedNavigate = useCallback(
    async (to, options) => {
      // La misma pregunta que las ventanas, no la del navegador (auditoría
      // UX/UI, fase 2).
      if (haySinGuardar() && !(await confirmarDescarte())) {
        return false;
      }
      setIsDirty(false);
      navigate(to, options);
      return true;
    },
    [navigate],
  );

  return (
    <UnsavedChangesContext.Provider
      value={{ isDirty, setIsDirty, guardedNavigate, registrarVerificador }}
    >
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error(
      "useUnsavedChanges debe usarse dentro de un <UnsavedChangesProvider>.",
    );
  }
  return context;
}

/** Lo mismo, pero sin exigir el proveedor: devuelve null fuera de /admin
 * (las pruebas de un componente suelto, por ejemplo). */
export function useUnsavedChangesOpcional() {
  return useContext(UnsavedChangesContext);
}
