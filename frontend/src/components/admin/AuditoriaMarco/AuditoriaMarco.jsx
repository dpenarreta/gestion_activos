import { Navigate } from "react-router-dom";

import { useAuth } from "../../../hooks/useAuth";

/**
 * Auditoría: una sola pantalla para todo el sistema (20/10/2026), sin
 * pestañas; el módulo se elige con un filtro (ver `AuditoriaList`).
 *
 * Como Reportes, la auditoría no es de un módulo ni una opción más de
 * Configuración: vive en el bloque «General» del menú, igual en todos. El
 * registro general exige `auditoria.ver`; el historial de la Matriz,
 * `matriz.ver_auditoria` en la empresa activa (§15.9). Con cualquiera de los
 * dos se entra; el filtro ofrece lo que cada quien puede ver.
 */
export const SECCIONES_AUDITORIA = [
  {
    id: "sistema",
    nombre: "Sistema",
    path: "/admin/auditoria",
    permission: ["auditoria.ver"],
  },
  {
    id: "matriz",
    nombre: "Matriz",
    path: "/admin/auditoria/matriz",
    permission: ["matriz.ver_auditoria"],
  },
  {
    // Quién descargó cada archivo (26/10/2026).
    id: "descargas",
    nombre: "Descargas",
    path: "/admin/auditoria?modulo=descargas",
    permission: ["auditoria.descargas"],
  },
];

/** Todos los permisos que abren alguna pestaña: los del menú. */
export const PERMISOS_AUDITORIA = [
  ...new Set(SECCIONES_AUDITORIA.flatMap((seccion) => seccion.permission)),
];

export function esRutaDeAuditoria(pathname) {
  return (
    pathname === "/admin/auditoria" || pathname.startsWith("/admin/auditoria/")
  );
}

export function seccionesDeAuditoriaVisibles(permisos = []) {
  return SECCIONES_AUDITORIA.filter((seccion) =>
    seccion.permission.some((codigo) => permisos.includes(codigo)),
  );
}

/** Se entra con cualquiera de los dos permisos; sin ninguno, 403. */
export function AuditoriaInicio({ children }) {
  const { user, isAuthenticated, isInitializing } = useAuth();
  if (isInitializing) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (seccionesDeAuditoriaVisibles(user?.permissions || []).length === 0) {
    return <Navigate to="/403" replace />;
  }
  return children;
}

/** El marco de la Auditoría: ya sin pestañas, solo el contenido. */
export function AuditoriaMarco({ children }) {
  return (
    <div className="auditoria-marco">
      <div className="mz-config-body">{children}</div>
    </div>
  );
}
