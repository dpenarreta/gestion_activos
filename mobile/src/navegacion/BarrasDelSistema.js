import { NavigationBar } from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";

import { useApariencia } from "../tema/apariencia";

/**
 * Las barras del sistema según el modo (US-026).
 *
 * - La barra de estado sobre los fondos de la app (inicio de sesión, carga):
 *   letra oscura en claro y clara en oscuro. Dentro de la app la cabecera es
 *   siempre negra y `(app)/_layout.js` la pone clara.
 * - La barra de navegación de Android (ronda QA): transparente, sin el velo
 *   del sistema (`enforceContrast: false` en `app.config.js`), sobre el fondo
 *   de la app, con los botones oscuros en claro y claros en oscuro. Su `style`
 *   es el color de los botones. En iOS no hace nada.
 */
export function BarrasDelSistema() {
  const { oscuro } = useApariencia();
  return (
    <>
      <StatusBar style={oscuro ? "light" : "dark"} />
      <NavigationBar style={oscuro ? "light" : "dark"} />
    </>
  );
}
