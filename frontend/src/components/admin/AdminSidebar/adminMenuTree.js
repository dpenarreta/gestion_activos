/** Lógica pura de "¿esta ruta está activa?", compartida por `AdminSidebar.jsx`,
 * `AdminMenuGroup.jsx`/`AdminMenuItem.jsx` y `useMenuAccordion.js`. */
export function matchesPath(path, currentPath) {
  return Boolean(path) && (currentPath === path || currentPath.startsWith(`${path}/`));
}

export function hasActiveDescendant(item, currentPath) {
  if (matchesPath(item.path, currentPath)) {
    return true;
  }
  return (item.children || []).some((child) => hasActiveDescendant(child, currentPath));
}
