import { Navigate } from "react-router-dom";

import { useAuth } from "../../../hooks/useAuth";
import { EstadoDeCarga } from "../EstadoDeCarga/EstadoDeCarga";

/** `permission` es un permiso o una lista: con la lista, basta uno. */
export function RequirePermission({ permission, children }) {
  const { user, isAuthenticated, isInitializing } = useAuth();

  // Mientras se recupera la sesión, «Cargando…» y no la pantalla en blanco
  // (auditoría UX/UI, 30/10/2026).
  if (isInitializing) {
    return <EstadoDeCarga cargando />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  const pedidos = Array.isArray(permission) ? permission : [permission];
  if (!pedidos.some((p) => user?.permissions?.includes(p))) {
    return <Navigate to="/403" replace />;
  }
  return children;
}
