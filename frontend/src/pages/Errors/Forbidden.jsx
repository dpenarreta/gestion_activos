import { Link } from "react-router-dom";

import { useAdminMenu } from "../../hooks/useAdminMenu";
import { useAuth } from "../../hooks/useAuth";
import "./Errors.css";

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
  const { logout } = useAuth();
  const menu = useAdminMenu();
  const sinNingunPermiso = menu.length === 0;

  return (
    <div className="container error-page">
      <h1>403</h1>
      <h2>Acceso denegado</h2>
      {sinNingunPermiso ? (
        <>
          <p className="text-muted">
            Su cuenta todavía no tiene ningún permiso asignado, así que no hay
            ninguna pantalla que pueda abrir. Pídale a un administrador que le
            asigne un rol.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => logout()}
          >
            Cerrar sesión
          </button>
        </>
      ) : (
        <>
          <p className="text-muted">
            No tiene los permisos necesarios para ver esta página.
          </p>
          <Link to="/admin" className="btn btn-primary">
            Volver al panel
          </Link>
        </>
      )}
    </div>
  );
}
