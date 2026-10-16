/**
 * Único punto de verificación de permisos del editor visual (sección 6 del prompt de
 * personalización). La aplicación no tiene sistema de autenticación (decisión documentada en el
 * README), así que hoy concede todos los permisos sin verificar nada — pero todo el editor
 * consulta exclusivamente este hook, así que conectar roles/usuarios reales después es cambiar
 * esta función, no la lógica de cada componente.
 */
export const PERMISOS = {
  DASHBOARD_VIEW: 'dashboard.view',
  DASHBOARD_EDIT: 'dashboard.edit',
  DASHBOARD_LAYOUT_EDIT: 'dashboard.layout.edit',
  DASHBOARD_COMPONENT_STYLE: 'dashboard.component.style',
  DASHBOARD_COMPONENT_CREATE: 'dashboard.component.create',
  DASHBOARD_COMPONENT_DELETE: 'dashboard.component.delete',
  DASHBOARD_CONFIGURATION_RESET: 'dashboard.configuration.reset',
}

export function usePermisos() {
  const concedidos = Object.fromEntries(Object.values(PERMISOS).map((p) => [p, true]))
  return {
    tiene: (permiso) => Boolean(concedidos[permiso]),
    ...concedidos,
  }
}
