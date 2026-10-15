import { useCallback, useEffect, useState } from "react";

import { adminUsersService } from "../api/adminUsersService";
import { useUltimaPeticion } from "./useUltimaPeticion";

const DEFAULT_FILTERS = {
  q: "",
  status: "",
  role: "",
  created_from: "",
  created_to: "",
};

export function useAdminUsers() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({
    results: [],
    count: 0,
    next: null,
    previous: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const nuevaPeticion = useUltimaPeticion();

  const fetchUsers = useCallback(() => {
    // Solo cuenta la última: si la carga inicial llega después de la
    // filtrada, la pisaría (se busca «ana» y se ven todas las cuentas).
    const vigente = nuevaPeticion();
    setIsLoading(true);
    setError(null);
    const params = { page };
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params[key] = value;
    });
    return adminUsersService
      .list(params)
      .then((respuesta) => vigente() && setData(respuesta))
      .catch((err) => {
        if (!vigente()) return;
        setError(
          err.response?.data?.error?.message ||
            "No se pudo cargar el listado de usuarios.",
        );
      })
      .finally(() => vigente() && setIsLoading(false));
  }, [filters, page, nuevaPeticion]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Cambiar un filtro vuelve a la página 1; cambiar solo de página conserva
  // los filtros vigentes (criterio de aceptación de búsqueda y paginación).
  function updateFilters(partialFilters) {
    setFilters((current) => ({ ...current, ...partialFilters }));
    setPage(1);
  }

  return {
    users: data.results,
    count: data.count,
    hasNext: Boolean(data.next),
    hasPrevious: Boolean(data.previous),
    page,
    setPage,
    filters,
    updateFilters,
    isLoading,
    error,
    refresh: fetchUsers,
  };
}
