import { getVisibleAdminMenu } from "../components/admin/AdminSidebar/staticAdminMenu";
import { useAuth } from "./useAuth";

/** Reemplaza al `useAdministrativeMenu` dinámico del proyecto original:
 * el árbol es estático (ver `staticAdminMenu.js`), solo se filtra por los
 * permisos del usuario autenticado. */
export function useAdminMenu() {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return [];
  }
  return getVisibleAdminMenu(user?.permissions || []);
}
