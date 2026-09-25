import { useCallback, useEffect, useState } from "react";

import { auditoriaService } from "../api/auditoriaService";

const FILTROS_INICIALES = {
  actor_username: "",
  action: "",
  module: "",
  result: "",
  created_from: "",
  created_to: "",
};

export function useAuditoria() {
  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState({
    results: [],
    count: 0,
    next: null,
    previous: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const parametrosVigentes = useCallback(() => {
    return Object.fromEntries(
      Object.entries(filtros).filter(([, valor]) => valor !== ""),
    );
  }, [filtros]);

  const consultar = useCallback(() => {
    setIsLoading(true);
    setError(null);
    return auditoriaService
      .list({ page: pagina, ...parametrosVigentes() })
      .then(setDatos)
      .catch((err) => {
        setError(
          err.response?.data?.error?.message ||
            "No se pudo cargar el registro de auditoría.",
        );
      })
      .finally(() => setIsLoading(false));
  }, [pagina, parametrosVigentes]);

  useEffect(() => {
    consultar();
  }, [consultar]);

  // Cambiar un filtro vuelve a la página 1; cambiar de página conserva los
  // filtros, igual que en el resto de listados del panel.
  function actualizarFiltros(parciales) {
    setFiltros((actuales) => ({ ...actuales, ...parciales }));
    setPagina(1);
  }

  function limpiarFiltros() {
    setFiltros(FILTROS_INICIALES);
    setPagina(1);
  }

  return {
    eventos: datos.results,
    total: datos.count,
    haySiguiente: Boolean(datos.next),
    hayAnterior: Boolean(datos.previous),
    pagina,
    setPagina,
    filtros,
    actualizarFiltros,
    limpiarFiltros,
    parametrosVigentes,
    isLoading,
    error,
    refrescar: consultar,
  };
}
