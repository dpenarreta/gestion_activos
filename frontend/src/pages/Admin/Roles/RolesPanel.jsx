import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { rolesService } from "../../../api/rolesService";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./RolesPanel.css";

/**
 * Listado de roles.
 *
 * Es un panel y no una página completa: vive dentro de `RolesPage`, que aporta
 * las migas de pan, el título y las pestañas compartidas con el catálogo de
 * permisos.
 */
export function RolesPanel() {
  const puedeEditar = usePermission("roles.editar");
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [aEliminar, setAEliminar] = useState(null);

  function loadRoles() {
    setIsLoading(true);
    rolesService
      .list()
      .then(setRoles)
      .catch(() => setError("No se pudo cargar el listado de roles."))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadRoles();
  }, []);

  async function confirmarEliminacion() {
    try {
      await rolesService.remove(aEliminar.id);
      setAEliminar(null);
      setError(null);
      loadRoles();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo eliminar el rol."));
      setAEliminar(null);
    }
  }

  return (
    <div className="roles-list-page">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <p className="text-muted mb-0">
          Un rol agrupa permisos. Se asigna a un usuario desde su ficha, en{" "}
          <Link to="/admin/users">Usuarios</Link>.
        </p>
        {puedeEditar && (
          <Link to="/admin/roles/new" className="btn btn-primary btn-sm">
            Nuevo rol
          </Link>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Nombre</th>
              <th className="text-end">Permisos</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>{role.name}</td>
                <td className="text-end">{role.permission_codenames.length}</td>
                <td>
                  <div className="d-flex gap-2">
                    <Link
                      to={`/admin/roles/${role.id}`}
                      className="btn btn-accion btn-sm"
                    >
                      {puedeEditar ? "Editar" : "Ver"}
                    </Link>
                    {puedeEditar && (
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => setAEliminar(role)}
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && roles.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-muted">
                  Sin roles registrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        isOpen={Boolean(aEliminar)}
        title="Eliminar rol"
        message={
          aEliminar
            ? `Se eliminará el rol "${aEliminar.name}". Los usuarios que lo tengan asignado perderán los ${aEliminar.permission_codenames.length} permisos que otorga.`
            : ""
        }
        onConfirm={confirmarEliminacion}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}
