import { useCallback, useEffect, useState } from "react";

import { adminUsersService } from "../api/adminUsersService";

const DEFAULT_FILTERS = { q: "", status: "", role: "", created_from: "", created_to: "" };

export function useAdminUsers() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ results: [], count: 0, next: null, previous: null });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchUsers = useCallback(() => {
    setIsLoading(true);
    setError(null);
    const params = { page };
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params[key] = value;
    });
    return adminUsersService
      .list(params)
      .then(setData)
      .catch((err) => {
        setError(err.response?.data?.error?.message || "No se pudo cargar el listado de usuarios.");
      })
      .finally(() => setIsLoading(false));
  }, [filters, page]);

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
