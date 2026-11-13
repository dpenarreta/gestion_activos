import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { chatService } from "../api/servicios";

/** Cada cuánto se vuelve a preguntar quién está en línea, como la web
 * (`Presencia.jsx`). */
export const REFRESCO_PRESENCIA_MS = 30_000;
/** El servidor responde por hasta 200 personas (`presencia.MAXIMO`). */
const MAXIMO_IDS = 200;

/** Si la app está en primer plano. */
export function useAppActiva() {
  const [activa, setActiva] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  useEffect(() => {
    const suscripcion = AppState.addEventListener("change", (estado) => {
      setActiva(estado !== "background" && estado !== "inactive");
    });
    return () => suscripcion.remove();
  }, []);
  return activa;
}

/** Si la pantalla tiene el foco (Expo Router). */
export function useEnFoco() {
  const [enFoco, setEnFoco] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setEnFoco(true);
      return () => setEnFoco(false);
    }, []),
  );
  return enFoco;
}

/**
 * La presencia de las personas `ids` (`/chat/presencia/?ids=`): `{id:
 * {en_linea, ultima_conexion, estado}}`. Se pide al aparecer y cada medio
 * minuto, solo mientras la pantalla tiene el foco y la app está en primer
 * plano. Si falla, se conserva lo anterior.
 */
export function usePresencia(ids) {
  const clave = [...new Set((ids ?? []).filter((id) => id !== undefined && id !== null).map(String))]
    .sort()
    .slice(0, MAXIMO_IDS)
    .join(",");
  const [estados, setEstados] = useState({});
  const appActiva = useAppActiva();
  const enFoco = useEnFoco();
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    if (!clave || !appActiva || !enFoco) return undefined;
    let vigente = true;
    const pedir = () =>
      chatService
        .presencia(clave.split(","))
        .then((datos) => {
          if (vigente && montado.current && datos && typeof datos === "object") setEstados(datos);
        })
        .catch(() => {});
    pedir();
    const intervalo = setInterval(pedir, REFRESCO_PRESENCIA_MS);
    return () => {
      vigente = false;
      clearInterval(intervalo);
    };
  }, [clave, appActiva, enFoco]);

  return estados;
}
