import { Link } from "react-router-dom";

import {
  conPermiso,
  modulosConPermiso,
} from "../../components/admin/AdminSidebar/staticAdminMenu";
import { useAdminMenu } from "../../hooks/useAdminMenu";
import { useAuth } from "../../hooks/useAuth";
import "./Errors.css";
import { RUTA_DE_ENTRADA } from "../../modulos/modulos";

/**
 * Acceso denegado.
 *
 * Distingue dos situaciones que se arreglan de formas muy distintas. Quien
 * tiene permisos y ha llegado a una pantalla que no le toca solo necesita
 * volver: el panel lo devuelve a lo suyo. Pero a quien no tiene **ninguno** —una
 * cuenta recién creada a la que nadie asignó un rol— ese botón lo traería de
 * vuelta aquí, porque no hay ninguna pantalla que pueda abrir. A esa persona
 * hay que decirle qué pasa y a quién pedírselo, y dejarle salir.
 */
export function Forbidden() {
  const { logout, user } = useAuth();
  const menu = useAdminMenu();
  // En ningún módulo, no solo en el que se estaba: quien no tiene nada del
  // inventario pero sí de la Matriz no es una cuenta sin permisos.
  // Solo cuentan las opciones que exigen un permiso.
  const sinNingunPermiso =
    conPermiso(menu).length === 0 &&
    modulosConPermiso(user?.permissions || []).length === 0;

  return (
    <div className="mz-error-page">
      <div className="mz-error-card">
        <span className="mz-error-code">403</span>
        <h1>Acceso denegado</h1>
        {sinNingunPermiso ? (
          <>
            <p className="mz-desc">
              Su cuenta todavía no tiene ningún permiso asignado, así que no hay
              ninguna pantalla que pueda abrir. Pídale a un administrador que le
              asigne un rol; mientras tanto, puede pedir soporte.
            </p>
            <div className="mz-actions justify-content-center">
              <Link className="btn btn-outline-primary" to="/admin/ayuda">
                Pedir soporte
              </Link>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => logout()}
              >
                Cerrar sesión
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mz-desc">
              No tiene los permisos necesarios para ver esta página.
            </p>
            <Link to={RUTA_DE_ENTRADA} className="btn btn-primary">
              Volver al panel
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
