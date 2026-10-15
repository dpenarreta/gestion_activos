import { getVisibleAdminMenu } from "../components/admin/AdminSidebar/staticAdminMenu";
import { useModuloActivo } from "../modulos/useModuloActivo";
import { useAuth } from "./useAuth";

/** El menú del módulo activo, filtrado por los permisos del usuario
 * autenticado (ver `staticAdminMenu.js`). Con `modulo` se pide el de otro. */
export function useAdminMenu(modulo) {
  const { user, isAuthenticated } = useAuth();
  const activo = useModuloActivo();
  if (!isAuthenticated) {
    return [];
  }
  return getVisibleAdminMenu(user?.permissions || [], modulo ?? activo);
}
