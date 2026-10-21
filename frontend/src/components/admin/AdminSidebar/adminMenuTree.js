/** Lógica pura de "¿esta ruta está activa?", compartida por `AdminSidebar.jsx`,
 * `AdminMenuGroup.jsx`/`AdminMenuItem.jsx` y `useMenuAccordion.js`. */
export function matchesPath(path, currentPath) {
  return (
    Boolean(path) &&
    (currentPath === path || currentPath.startsWith(`${path}/`))
  );
}

/**
 * El prefijo más largo de una entrada que coincide con la ruta, o `null`.
 *
 * Una entrada suele tener una sola dirección (`path`), pero «Configuración»
 * abarca pantallas con direcciones propias —`/admin/users`, `/admin/empresas`…—
 * y las declara en `rutas`. Se devuelve el largo y no un sí/no para que el
 * título de la barra superior elija la coincidencia más específica.
 */
export function coincidencia(item, currentPath) {
  // `exacto`: la entrada es solo su dirección, no las que cuelgan de ella
  // («Consultar rol de pagos» no se marca en sus observaciones).
  if (item.exacto) {
    return item.path && currentPath === item.path ? item.path : null;
  }
  const candidatas = [item.path, ...(item.rutas || [])].filter((ruta) =>
    matchesPath(ruta, currentPath),
  );
  if (candidatas.length === 0) return null;
  return candidatas.reduce((a, b) => (b.length > a.length ? b : a));
}

export function hasActiveDescendant(item, currentPath) {
  if (coincidencia(item, currentPath)) {
    return true;
  }
  return (item.children || []).some((child) =>
    hasActiveDescendant(child, currentPath),
  );
}
