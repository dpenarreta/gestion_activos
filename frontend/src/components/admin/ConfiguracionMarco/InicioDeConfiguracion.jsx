import { Navigate } from "react-router-dom";

import { useAuth } from "../../../hooks/useAuth";
import { seccionesVisibles } from "./seccionesConfiguracion";

/**
 * A dónde lleva la entrada «Configuración» del menú: a la primera sección que
 * la persona puede abrir. No a una fija: quien solo administra empresas no
 * tiene por qué aterrizar en un 403 de usuarios.
 */
export function InicioDeConfiguracion() {
  const { user, isInitializing } = useAuth();
  if (isInitializing) return null;
  const primera = seccionesVisibles(user?.permissions || [])[0];
  return <Navigate to={primera?.path ?? "/403"} replace />;
}
