import { Navigate } from "react-router-dom";

import { getVisibleAdminMenu } from "../../components/admin/AdminSidebar/staticAdminMenu";
import { useAuth } from "../../hooks/useAuth";

/** Las entradas con dirección, recorriendo las secciones del menú. */
function conDireccion(items) {
  return items.flatMap((item) => [
    ...(item.path ? [item] : []),
    ...conDireccion(item.children ?? []),
  ]);
}

/**
 * La entrada del módulo lleva a la primera pantalla que la persona puede
 * abrir: quien solo consulta Ingresos y salidas no tiene acceso a Días
 * laborados, y quien solo trabaja Tareas no tiene Control operativo; mandarlo
 * ahí sería un «sin acceso» de entrada.
 */
export function InicioGestionHumana() {
  const { user } = useAuth();
  const primera = conDireccion(
    getVisibleAdminMenu(user?.permissions ?? [], "gestion_humana").filter(
      (entrada) => entrada.modulo === "gestion_humana",
    ),
  )[0];
  return <Navigate to={primera?.path ?? "/403"} replace />;
}
