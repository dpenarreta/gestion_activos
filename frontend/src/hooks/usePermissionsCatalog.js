import { useCallback, useEffect, useState } from "react";

import { permissionsService } from "../api/permissionsService";

/**
 * El catálogo de permisos. `recargar` lo vuelve a pedir tras un fallo, para
 * el «Reintentar» del aviso de error (auditoría UX/UI, fase 2, 28/10/2026).
 */
export function usePermissionsCatalog() {
  const [catalog, setCatalog] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const recargar = useCallback(() => {
    setIsLoading(true);
    setError(null);
    permissionsService
      .catalog()
      .then(setCatalog)
      .catch(() => setError("No se pudo cargar el catálogo de permisos."))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { catalog, isLoading, error, recargar };
}
