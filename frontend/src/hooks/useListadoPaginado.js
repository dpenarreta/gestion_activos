import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Listado paginado con filtros, genérico para los módulos de negocio.
 *
 * Generaliza el patrón de `useAdminUsers`, que quedó atado a su servicio y a
 * su juego de filtros. Los cinco listados del dominio (activos, empleados,
 * departamentos, mantenimientos, componentes) tienen exactamente la misma
 * mecánica: filtros que reinician a la página 1, paginación que los conserva,
 * y un `refresh` para releer tras una mutación.
 *
 * `useAdminUsers` se deja como está: reescribirlo sobre este hook no
 * aportaría nada al usuario y tocaría código ya probado.
 */
export function useListadoPaginado(
  cargar,
  filtrosIniciales = {},
  mensajeError = "No se pudo cargar el listado.",
) {
  const [filtros, setFiltros] = useState(filtrosIniciales);
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState({
    results: [],
    count: 0,
    next: null,
    previous: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Cuál es la consulta vigente. Dos peticiones pueden estar en vuelo a la vez
  // —se escribe un filtro mientras la carga inicial todavía viaja— y no llegan
  // necesariamente en el orden en que se pidieron: sin esto gana la última en
  // llegar, y la pantalla termina mostrando el listado sin filtrar con el
  // filtro escrito en la caja, que es mentir sobre lo que se está viendo.
  const vigente = useRef(0);

  const consultar = useCallback(() => {
    setIsLoading(true);
    setError(null);
    const esta = ++vigente.current;
    const params = { page: pagina };
    Object.entries(filtros).forEach(([clave, valor]) => {
      if (valor !== "" && valor !== null && valor !== undefined) {
        params[clave] = valor;
      }
    });
    return cargar(params)
      .then((respuesta) => {
        if (esta !== vigente.current) return;
        // Un endpoint sin paginar devuelve una lista pelada; se normaliza para
        // que la vista no tenga que distinguir los dos casos.
        setDatos(
          Array.isArray(respuesta)
            ? {
                results: respuesta,
                count: respuesta.length,
                next: null,
                previous: null,
              }
            : respuesta,
        );
      })
      .catch((err) => {
        if (esta !== vigente.current) return;
        setError(err.response?.data?.error?.message || mensajeError);
      })
      .finally(() => {
        // El indicador de carga también es de la consulta vigente: apagarlo
        // desde una vieja diría «ya está» con la nueva todavía en camino.
        if (esta === vigente.current) setIsLoading(false);
      });
  }, [cargar, filtros, pagina, mensajeError]);

  useEffect(() => {
    consultar();
  }, [consultar]);

  // Cambiar un filtro vuelve a la página 1; cambiar de página conserva los
  // filtros vigentes.
  function actualizarFiltros(parciales) {
    setFiltros((actuales) => ({ ...actuales, ...parciales }));
    setPagina(1);
  }

  return {
    resultados: datos.results,
    total: datos.count,
    hasNext: Boolean(datos.next),
    hasPrevious: Boolean(datos.previous),
    pagina,
    setPagina,
    filtros,
    actualizarFiltros,
    isLoading,
    error,
    setError,
    refresh: consultar,
  };
}
