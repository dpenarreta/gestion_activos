import { useMemo } from "react";

import { useTotalNoLeidos } from "../chat/ChatContext";
import { useResumenPermisos } from "../permisos/ResumenPermisosContext";
import { useSesion } from "../sesion/SesionContext";
import { useResumenSoporte } from "../soporte/ResumenSoporteContext";

/**
 * El `contexto` del catálogo (`navegacion/modulos.js`) con lo que ya tenía la
 * app: los permisos de la sesión y los resúmenes de permisos, chat y Mesa de
 * ayuda (US-016). `vistas`: la vista abierta de cada módulo, para las
 * excepciones («Aprobaciones» porque un aviso llevó a ella).
 */
export function useContextoDeNavegacion(vistas) {
  const { usuario } = useSesion();
  const { porAprobar, puedeSolicitar, cargado } = useResumenPermisos();
  const totalNoLeidos = useTotalNoLeidos();
  const { delEquipo, noEsDelEquipo, misPendientes, asignados, aprobaciones } = useResumenSoporte();
  const permisos = usuario?.permissions;
  const institucional = vistas?.institucional;
  const mesa = vistas?.mesa;
  return useMemo(
    () => ({
      permisos: permisos ?? [],
      licencias: { porAprobar, puedeSolicitar, cargado },
      chat: { totalNoLeidos },
      soporte: { delEquipo, noEsDelEquipo, misPendientes, asignados, aprobaciones },
      vistas: { institucional, mesa },
    }),
    [
      permisos,
      porAprobar,
      puedeSolicitar,
      cargado,
      totalNoLeidos,
      delEquipo,
      noEsDelEquipo,
      misPendientes,
      asignados,
      aprobaciones,
      institucional,
      mesa,
    ],
  );
}
