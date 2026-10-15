import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { moduloDeRuta, moduloRecordado, recordarModulo } from "./modulos";

/**
 * En qué módulo se está: el de la ruta si tiene uno; en las pantallas comunes
 * (Configuración), el último elegido, para que abrir Usuarios desde la Matriz
 * no devuelva el menú del inventario.
 */
export function useModuloActivo() {
  const { pathname } = useLocation();
  const propio = moduloDeRuta(pathname);

  useEffect(() => {
    if (propio) recordarModulo(propio);
  }, [propio]);

  return propio ?? moduloRecordado();
}
