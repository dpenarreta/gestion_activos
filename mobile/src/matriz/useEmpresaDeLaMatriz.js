import { useCallback, useEffect, useRef, useState } from "react";

import { useSesion } from "../sesion/SesionContext";
import { olvidarEmpresaDeLaMatriz, pedirEmpresasDeLaMatriz } from "./empresaGuardada";
import { empresaDeLaMatriz } from "./formato";

/**
 * La empresa activa tal como la ve la Matriz (US-019, CA-1): su zona horaria
 * (los vencimientos se dicen en ella), sus roles y sus capacidades, de
 * `matriz/empresas/mias/`, como `RequiereRolMatriz` y `ResumenMatriz` de la
 * web. Sin la empresa activa en esa lista, la persona no tiene un rol de la
 * Matriz en ella (`estado: "sin_rol"`).
 *
 * La respuesta se guarda por cuenta, empresa y versión
 * (`empresaGuardada.js`); al cambiar la clave se vuelve a «cargando».
 */
export { olvidarEmpresaDeLaMatriz };

/** `{estado: "cargando"|"listo"|"sin_rol"|"error", empresa, zona, error,
 * recargar}`. */
export function useEmpresaDeLaMatriz() {
  const { usuario, empresaActiva, versionEmpresa } = useSesion();
  const activa = empresaActiva?.id ?? null;
  const cuenta = usuario?.id ?? null;
  const ultimaClave = useRef(null);
  const [resultado, setResultado] = useState({ estado: "cargando", empresa: null, error: null });
  const [intento, setIntento] = useState(0);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    let vigente = true;
    const clave = `${cuenta ?? ""}|${activa ?? ""}|${versionEmpresa ?? 0}`;
    // Otra cuenta o empresa: nada de lo anterior vale. El mismo (Reintentar):
    // lo que se ve se queda hasta que llegue la respuesta.
    const otra = ultimaClave.current !== clave;
    ultimaClave.current = clave;
    setResultado((r) => (!otra && r.estado === "listo" ? r : { estado: "cargando", empresa: null, error: null }));
    pedirEmpresasDeLaMatriz(clave)
      .then((datos) => {
        if (!vigente || !montado.current) return;
        const empresa = empresaDeLaMatriz(datos?.empresas, activa);
        setResultado(
          empresa ? { estado: "listo", empresa, error: null } : { estado: "sin_rol", empresa: null, error: null },
        );
      })
      .catch((error) => {
        if (!vigente || !montado.current) return;
        setResultado({ estado: "error", empresa: null, error });
      });
    return () => {
      vigente = false;
    };
  }, [cuenta, activa, versionEmpresa, intento]);

  const recargar = useCallback(() => {
    olvidarEmpresaDeLaMatriz();
    setIntento((n) => n + 1);
  }, []);

  return { ...resultado, zona: resultado.empresa?.zona_horaria ?? null, recargar };
}
