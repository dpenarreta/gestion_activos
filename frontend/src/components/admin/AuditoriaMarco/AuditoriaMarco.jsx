import { Link, Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../../../hooks/useAuth";

/**
 * Las pestañas de Auditoría, una sola para todo el sistema.
 *
 * Como Reportes, la auditoría no es de un módulo ni una opción más de
 * Configuración: vive en el bloque «General» del menú, igual en todos. La del
 * sistema exige `auditoria.ver`; la de la Matriz, `matriz.ver_auditoria` en la
 * empresa activa (§15.9). Una pestaña aparece si se puede abrir. Cada pantalla
 * trae su propio encabezado, así que el marco solo pone las pestañas.
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

function seccionDeRuta(pathname) {
  // Gana la más larga: «/admin/auditoria/matriz» es la Matriz, no Sistema.
  return [...SECCIONES_AUDITORIA]
    .sort((a, b) => b.path.length - a.path.length)
    .find((s) => pathname === s.path || pathname.startsWith(`${s.path}/`));
}

/**
 * `/admin/auditoria` es la del sistema —la dirección de siempre—. Quien no la
 * puede abrir pero sí la de la Matriz, cae en esa en vez de en un 403.
 */
export function AuditoriaInicio({ children }) {
  const { user, isAuthenticated, isInitializing } = useAuth();
  if (isInitializing) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const permisos = user?.permissions || [];
  if (permisos.includes("auditoria.ver")) return children;
  const otra = seccionesDeAuditoriaVisibles(permisos)[0];
  return <Navigate to={otra?.path ?? "/403"} replace />;
}

export function AuditoriaMarco({ children }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const visibles = seccionesDeAuditoriaVisibles(user?.permissions || []);
  const actual = seccionDeRuta(pathname);

  return (
    <div className="auditoria-marco">
      {visibles.length > 1 && (
        <nav className="mz-tabs mz-config-tabs" aria-label="Auditoría">
          {visibles.map((seccion) => {
            const activa = seccion.id === actual?.id;
            return (
              <Link
                key={seccion.id}
                to={seccion.path}
                className={activa ? "is-active" : undefined}
                aria-current={activa ? "page" : undefined}
              >
                {seccion.nombre}
              </Link>
            );
          })}
        </nav>
      )}
      <div className="mz-config-body">{children}</div>
    </div>
  );
}
