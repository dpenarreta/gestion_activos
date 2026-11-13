import { moduloPorId, pantallaDe } from "./modulos";

/**
 * Cómo se abre lo del catálogo (US-016). `navigation` es la de una pantalla
 * de `(tabs)` (la que reciben `header` o el descriptor de la ruta activa en
 * `tabBar`), que sabe ir a otra pestaña; `router`, el de Expo Router para
 * las pantallas del Stack.
 *
 * `merge: true` conserva los parámetros que ya tenía la pantalla: volver a
 * un módulo lo deja en la vista en que estaba.
 */

/** La última pantalla de `(tabs)` en que estuvo cada módulo (Institucional
 * tiene dos: el Inicio y los permisos). La anota la barra. */
const ultimaPantalla = new Map();

export function recordarPantalla(modulo, pantalla) {
  if (modulo?.pantallas?.includes(pantalla)) ultimaPantalla.set(modulo.id, pantalla);
}

/** Para las pruebas. */
export function olvidarPantallas() {
  ultimaPantalla.clear();
}

export function abrirModulo(navigation, modulo) {
  navigation.navigate({ name: ultimaPantalla.get(modulo.id) ?? modulo.pantalla, merge: true });
}

/**
 * Una funcionalidad: la «vista» cambia el contenido del módulo sin apilar
 * pantallas; la «acción» abre su pantalla con «Volver».
 */
export function abrirFuncionalidad({ navigation, router, funcionalidad }) {
  const modulo = moduloPorId(funcionalidad.modulo);
  if (!modulo) return;
  if (funcionalidad.tipo === "vista") {
    navigation.navigate({ name: pantallaDe(funcionalidad, modulo), params: { ...funcionalidad.params }, merge: true });
    return;
  }
  router.push(funcionalidad.ruta);
}

/**
 * Volver a un módulo desde una pantalla del Stack («Ver mis tickets»,
 * «Volver a la bandeja», el detalle de una notificación que lleva a un
 * módulo). Los módulos ya están debajo: `dismissTo` cierra lo de encima y
 * cambia de pestaña y de vista, en lugar de apilar otra copia de los módulos
 * (con `replace`, «Volver» llevaba a la copia anterior). Si no están debajo,
 * `dismissTo` reemplaza la pantalla, como antes.
 */
export function volverAlModulo(router, ruta) {
  if (typeof router.dismissTo === "function") router.dismissTo(ruta);
  else router.replace(ruta);
}
