import { useEffect, useState } from "react";

import { permissionsService } from "../api/permissionsService";

export function usePermissionsCatalog() {
  const [catalog, setCatalog] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    permissionsService
      .catalog()
      .then(setCatalog)
      .catch(() => setError("No se pudo cargar el catálogo de permisos."))
      .finally(() => setIsLoading(false));
  }, []);

  return { catalog, isLoading, error };
}
