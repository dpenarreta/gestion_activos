import { Navigate } from "react-router-dom";

import { useAdminMenu } from "../hooks/useAdminMenu";
import { usePermission } from "../hooks/usePermission";

/**
 * A dónde entra cada quien al abrir `/admin`.
 *
 * Antes se iba siempre al panel principal, que exige `activos.ver`. Para quien
 * tiene un solo permiso —el «usuario final» del §13, cuyo rol lleva
 * únicamente `activos.ver_asignados`— eso significaba entrar al sistema y
 * chocar con un 403 teniendo su pantalla a un clic de distancia.
 *
 * El menú ya sabe qué puede abrir cada persona, así que la respuesta sale de
 * ahí: la primera opción que le queda visible. Para la mayoría es el panel
 * principal, porque es la primera del árbol para quien puede verlo.
 */
export function InicioDelPanel() {
  const menu = useAdminMenu();
  const veLoSuyo = usePermission("activos.ver_asignados");
  const destino = primeraRuta(menu);

  // «Mis equipos» se quitó del menú: es una vista personal y no una de
  // operación, y en la barra de quien administra el parque solo estorbaba. La
  // pantalla sigue existiendo, y para el usuario final sigue siendo la única
  // que puede abrir, así que el menú ya no puede ser la única fuente de este
  // destino: sin esta salida, su rol entraría al sistema y chocaría con el
  // mismo 403 que este componente existe para evitar.
  if (!destino && veLoSuyo) {
    return <Navigate to="/admin/mis-equipos" replace />;
  }

  // Sin ninguna opción visible no hay a dónde mandarlo, y el 403 es la verdad:
  // la cuenta existe pero todavía no tiene ningún permiso.
  return <Navigate to={destino ?? "/403"} replace />;
}

/** La primera pantalla del menú, entrando en los grupos si hace falta. */
function primeraRuta(items) {
  for (const item of items) {
    if (item.path) {
      return item.path;
    }
    const hija = primeraRuta(item.children ?? []);
    if (hija) {
      return hija;
    }
  }
  return null;
}
