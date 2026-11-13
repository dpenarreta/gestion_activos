import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { empresaDelPush, idDeNotificacionDelPush, identificadorDelPush } from "./push";

/**
 * Al tocar un push se abre el detalle de esa notificación (CA-10), también con
 * la app cerrada: al arrancar se lee la última respuesta guardada. Se usa
 * dentro de lo autenticado, porque abrirla exige sesión; si se tocó en el
 * login, se abre al entrar (la respuesta sigue guardada hasta usarla).
 *
 * - `activo` es falso mientras se muestra «AccionPendiente»: la respuesta no
 *   se consume y se atiende cuando la persona termina.
 * - Cada respuesta se atiende una sola vez (por su `identifier`): la del
 *   arranque en frío también puede llegar por el listener, y no debe abrir
 *   dos detalles (revisión de QA, 12/11/2026).
 * - Con `data.empresa`, el detalle la usa como `X-Empresa` (B3).
 */
export function useAbrirAlTocarPush(activo) {
  const router = useRouter();
  const atendidas = useRef(new Set());

  useEffect(() => {
    if (!activo) return undefined;
    function abrir(respuesta) {
      const id = idDeNotificacionDelPush(respuesta);
      if (!id) return;
      const clave = identificadorDelPush(respuesta) ?? `notificacion-${id}`;
      if (atendidas.current.has(clave)) return;
      atendidas.current.add(clave);
      Notifications.clearLastNotificationResponse?.();
      const empresa = empresaDelPush(respuesta);
      router.push({
        pathname: "/notificacion/[id]",
        params: empresa ? { id, empresa } : { id },
      });
    }
    const ultima = Notifications.getLastNotificationResponse?.();
    if (ultima) abrir(ultima);
    const suscripcion = Notifications.addNotificationResponseReceivedListener(abrir);
    return () => suscripcion.remove();
  }, [activo, router]);
}
