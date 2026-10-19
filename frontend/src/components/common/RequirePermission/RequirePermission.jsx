import { Navigate } from "react-router-dom";

import { useAuth } from "../../../hooks/useAuth";

/** `permission` es un permiso o una lista: con la lista, basta uno. */
export function RequirePermission({ permission, children }) {
  const { user, isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) {
    return null;
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
