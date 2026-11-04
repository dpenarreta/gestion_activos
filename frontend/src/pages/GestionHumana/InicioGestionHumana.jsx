import { Navigate } from "react-router-dom";

import { getVisibleAdminMenu } from "../../components/admin/AdminSidebar/staticAdminMenu";
import { useAuth } from "../../hooks/useAuth";

/**
 * La entrada del módulo lleva a la primera pantalla que la persona puede
 * abrir: quien solo consulta Ingresos y salidas no tiene acceso a Días
 * laborados, y mandarlo ahí sería un «sin acceso» de entrada.
 */
export function InicioGestionHumana() {
  const { user } = useAuth();
  const primera = getVisibleAdminMenu(
    user?.permissions ?? [],
    "gestion_humana",
  ).find((entrada) => entrada.modulo === "gestion_humana" && entrada.path);
  return <Navigate to={primera?.path ?? "/403"} replace />;
}
