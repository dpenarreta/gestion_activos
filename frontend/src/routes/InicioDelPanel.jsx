import { Navigate } from "react-router-dom";

import { useAdminMenu } from "../hooks/useAdminMenu";

/**
 * A dónde entra cada quien al abrir `/admin`.
 *
 * Antes se iba siempre al panel principal, que exige `activos.ver`. Para quien
 * tiene un solo permiso —el «usuario final» del §13, cuyo rol lleva
 * únicamente `activos.ver_asignados`— eso significaba entrar al sistema y
 * chocar con un 403 teniendo su pantalla a un clic de distancia.
 *
 * El menú ya sabe qué puede abrir cada persona, así que la respuesta sale de
 * ahí: la primera opción que le queda visible. Para la mayoría sigue siendo el
 * panel principal, porque es la primera del árbol para quien puede verlo.
 */
export function InicioDelPanel() {
  const menu = useAdminMenu();
  const destino = primeraRuta(menu);

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
