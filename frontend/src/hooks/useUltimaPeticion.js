import { useCallback, useRef } from "react";

/**
 * Para listados que se recargan al cambiar un filtro: solo cuenta la
 * respuesta de la **última** petición.
 *
 * Sin esto, si la carga inicial (sin filtro) tarda más que la filtrada, llega
 * después y la pisa: se busca «ana» y se ven todas las cuentas. Pasa con una
 * red lenta —el túnel— o al cambiar de filtro deprisa.
 *
 *     const nuevaPeticion = useUltimaPeticion();
 *     const cargar = useCallback(() => {
 *       const vigente = nuevaPeticion();
 *       servicio.listar(filtros).then((datos) => vigente() && setDatos(datos));
 *     }, [filtros, nuevaPeticion]);
 */
export function useUltimaPeticion() {
  const ultima = useRef(0);
  return useCallback(() => {
    const esta = ++ultima.current;
    return () => esta === ultima.current;
  }, []);
}
