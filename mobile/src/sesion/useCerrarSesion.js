import { useRef, useState } from "react";
import { Alert } from "react-native";

import { useSesion } from "./SesionContext";

/**
 * «Cerrar sesión» con confirmación y estado de carga. Lo usan «Cuenta» y la
 * pantalla de lo pendiente en la web, para que se comporten igual (revisión
 * de QA-UX, 12/11/2026).
 */
export function useCerrarSesion() {
  const { cerrarSesion } = useSesion();
  const [cerrando, setCerrando] = useState(false);
  const enCurso = useRef(false);

  function confirmarCierre() {
    if (enCurso.current) return;
    Alert.alert(
      "Cerrar sesión",
      "¿Desea cerrar la sesión en este teléfono? Dejará de recibir avisos.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar sesión",
          style: "destructive",
          onPress: async () => {
            enCurso.current = true;
            setCerrando(true);
            try {
              await cerrarSesion();
            } catch {
              // `cerrarSesion` deja el teléfono sin sesión pase lo que pase;
              // aquí solo se evita que el botón quede girando.
            } finally {
              // La pantalla suele desmontarse al quedar sin sesión; si no,
              // el botón vuelve a estar disponible.
              enCurso.current = false;
              setCerrando(false);
            }
          },
        },
      ],
    );
  }

  return { cerrando, confirmarCierre };
}
