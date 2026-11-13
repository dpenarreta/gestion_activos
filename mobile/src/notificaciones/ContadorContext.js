import * as Notifications from "expo-notifications";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { notificacionesService } from "../api/servicios";
import { useSesion } from "../sesion/SesionContext";

/**
 * El contador de no leídas de la pestaña (CA-6): sale del mismo
 * `/notificaciones/resumen/` que la campana web, así que coinciden. Se
 * consulta al entrar, al volver la app al frente, al llegar un push y cada
 * minuto mientras está abierta (la web lo hace cada 30 s; en el teléfono el
 * push ya avisa de lo nuevo y se ahorra batería).
 */
const REFRESCO_MS = 60_000;

const ContadorContext = createContext({ noLeidas: 0, recargar: () => {} });

export function ContadorProvider({ children }) {
  const { versionEmpresa } = useSesion();
  const [noLeidas, setNoLeidas] = useState(0);
  const montado = useRef(true);

  const recargar = useCallback(async () => {
    try {
      const datos = await notificacionesService.resumen();
      const cantidad = Number(datos?.no_leidas) || 0;
      if (montado.current) setNoLeidas(cantidad);
      Notifications.setBadgeCountAsync(cantidad).catch(() => {});
    } catch {
      // Se reintenta en la próxima consulta; el número anterior sigue.
    }
  }, []);

  useEffect(() => {
    montado.current = true;
    recargar();
    let intervalo = setInterval(recargar, REFRESCO_MS);
    const suscripcionApp = AppState.addEventListener("change", (estado) => {
      clearInterval(intervalo);
      if (estado === "active") {
        recargar();
        intervalo = setInterval(recargar, REFRESCO_MS);
      }
    });
    const suscripcionPush = Notifications.addNotificationReceivedListener(() => recargar());
    return () => {
      montado.current = false;
      clearInterval(intervalo);
      suscripcionApp.remove();
      suscripcionPush.remove();
    };
  }, [recargar, versionEmpresa]);

  const valor = useMemo(() => ({ noLeidas, recargar }), [noLeidas, recargar]);
  return <ContadorContext.Provider value={valor}>{children}</ContadorContext.Provider>;
}

export function useContador() {
  return useContext(ContadorContext);
}
