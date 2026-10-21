import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { useAlCambiarConfiguracion } from "../api/cambiosDeConfiguracion";
import { empresasService } from "../api/empresasService";

/**
 * Qué módulos están apagados en la empresa activa (21/10/2026).
 *
 * Un módulo apagado no aparece en el selector ni se puede abrir, tenga la
 * persona los permisos que tenga; el backend además niega su API. Solo el
 * superusuario y quien tiene `configuracion.modulos` lo siguen viendo
 * (`veApagados`), marcado como apagado.
 */
const SIN_DATOS = {
  modulos: [],
  apagados: new Set(),
  veApagados: false,
  cargado: false,
  recargar: () => {},
};

const Contexto = createContext(SIN_DATOS);

export function EstadoModulosProvider({ children }) {
  const [datos, setDatos] = useState(null);

  const recargar = useCallback(() => {
    // Sin el estado (error o sin red) todo se muestra: el backend igual
    // niega lo apagado.
    return Promise.resolve()
      .then(() => empresasService.modulos())
      .then(setDatos)
      .catch(() => setDatos(null));
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);
  useAlCambiarConfiguracion(["empresas"], recargar);

  const modulos = datos?.modulos ?? [];
  const valor = {
    modulos,
    apagados: new Set(modulos.filter((m) => !m.activo).map((m) => m.id)),
    veApagados: Boolean(datos?.ve_apagados),
    cargado: datos !== null,
    recargar,
  };
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useEstadoModulos() {
  return useContext(Contexto);
}
