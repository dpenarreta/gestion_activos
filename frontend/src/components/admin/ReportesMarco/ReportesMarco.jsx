import { Link, Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../../../hooks/useAuth";
import { PERMISOS_MATRIZ } from "../../../modulos/permisosMatriz";

/**
 * Las pestañas de Reportes, uno solo para todo el sistema.
 *
 * Los reportes no son de un módulo: viven en el bloque «General» del menú,
 * igual en todos, y cada asunto es una pestaña. Una pestaña aparece si se puede
 * abrir; la que termina en un 403 hace parecer roto el sistema.
 */
export const SECCIONES_REPORTES = [
  {
    id: "inventario",
    nombre: "Inventario",
    path: "/admin/reportes",
    permission: ["reportes.ver"],
  },
  {
    id: "matriz",
    nombre: "Matriz de obligaciones",
    path: "/admin/reportes/matriz",
    permission: PERMISOS_MATRIZ,
  },
];

/** Todos los permisos que abren alguna pestaña: los del menú. */
export const PERMISOS_REPORTES = [
  ...new Set(SECCIONES_REPORTES.flatMap((seccion) => seccion.permission)),
];

export function esRutaDeReportes(pathname) {
  return (
    pathname === "/admin/reportes" || pathname.startsWith("/admin/reportes/")
  );
}

export function seccionesDeReportesVisibles(permisos = []) {
  return SECCIONES_REPORTES.filter((seccion) =>
    seccion.permission.some((codigo) => permisos.includes(codigo)),
  );
}

function seccionDeRuta(pathname) {
  // Gana la más larga: «/admin/reportes/matriz» es la Matriz, no Inventario.
  return [...SECCIONES_REPORTES]
    .sort((a, b) => b.path.length - a.path.length)
    .find((s) => pathname === s.path || pathname.startsWith(`${s.path}/`));
}

/**
 * `/admin/reportes` es el de inventario —la dirección de siempre—. Quien no lo
 * puede abrir pero sí el de la Matriz, cae en ese en vez de en un 403.
 */
export function ReportesInicio({ children }) {
  const { user, isAuthenticated, isInitializing } = useAuth();
  // Hasta saber quién es, no se decide nada: sin esto, al entrar directo por
  // la dirección los permisos aún vienen vacíos y se mandaba a un 403.
  if (isInitializing) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const permisos = user?.permissions || [];
  if (permisos.includes("reportes.ver")) return children;
  const otra = seccionesDeReportesVisibles(permisos)[0];
  return <Navigate to={otra?.path ?? "/403"} replace />;
}

export function ReportesMarco({ children }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const visibles = seccionesDeReportesVisibles(user?.permissions || []);
  const actual = seccionDeRuta(pathname);

  return (
    <div className="reportes-marco">
      <div className="mz-view-head">
        <div>
          <h2>Reportes</h2>
          <p className="mz-desc">
            Los reportes de todo el sistema, cada asunto en su pestaña.
          </p>
        </div>
      </div>
      {visibles.length > 1 && (
        <nav className="mz-tabs mz-config-tabs" aria-label="Reportes">
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
