import * as Notifications from "expo-notifications";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { licenciasService } from "../api/servicios";
import { useSesion } from "../sesion/SesionContext";

/**
 * `/licencias/solicitudes/resumen/` para toda la parte autenticada (US-010):
 * la insignia de la pestaña «Permisos» (`por_aprobar`, CA-1) y si la cuenta
 * puede solicitar (`puede_solicitar`, CA-5). Se lee al entrar, al cambiar de
 * empresa (CA-13), al volver la app al frente, al llegar un push y cuando
 * una pantalla lo pide tras aprobar, rechazar o crear (CA-10).
 *
 * `cargado` distingue «todavía no se sabe» de «no puede solicitar»: mientras
 * carga no se desactiva nada ni se dice que falta un rol.
 */
const ResumenPermisosContext = createContext({
  porAprobar: 0,
  puedeSolicitar: true,
  cargado: false,
  recargar: async () => {},
});

export function ResumenPermisosProvider({ children }) {
  const { versionEmpresa } = useSesion();
  const [resumen, setResumen] = useState({ porAprobar: 0, puedeSolicitar: true, cargado: false });
  const montado = useRef(true);
  // Si cambia la empresa mientras viaja una respuesta, esa ya no se pinta.
  const consulta = useRef(0);

  const recargar = useCallback(async () => {
    const numero = ++consulta.current;
    try {
      const datos = await licenciasService.resumen();
      if (!montado.current || numero !== consulta.current) return;
      setResumen({
        porAprobar: Math.max(0, Number(datos?.por_aprobar) || 0),
        puedeSolicitar: datos?.puede_solicitar !== false,
        cargado: true,
      });
    } catch {
      // Se reintenta en la próxima ocasión; el número anterior sigue.
    }
  }, []);

  useEffect(() => {
    montado.current = true;
    recargar();
    const suscripcionApp = AppState.addEventListener("change", (estado) => {
      if (estado === "active") recargar();
    });
    // Un push de permisos cambia lo pendiente; uno de otro módulo cuesta una
    // petición pequeña.
    const suscripcionPush = Notifications.addNotificationReceivedListener(() => recargar());
    return () => {
      montado.current = false;
      suscripcionApp.remove();
      suscripcionPush.remove();
    };
  }, [recargar, versionEmpresa]);

  const valor = useMemo(() => ({ ...resumen, recargar }), [resumen, recargar]);
  return (
    <ResumenPermisosContext.Provider value={valor}>{children}</ResumenPermisosContext.Provider>
  );
}

export function useResumenPermisos() {
  return useContext(ResumenPermisosContext);
}

/** El texto de la web cuando la cuenta no tiene rol (CA-5). */
export const TEXTO_SIN_ROL =
  "Su cuenta no tiene un rol asignado, así que no puede solicitar permisos. " +
  "Pida a quien administra los usuarios que le asigne uno.";
