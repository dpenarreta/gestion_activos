import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { rolesService } from "../../../api/rolesService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import "./RolesList.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Roles" }];

export function RolesList() {
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

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

  async function handleDelete(role) {
    if (!window.confirm(`¿Eliminar el rol "${role.name}"?`)) {
      return;
    }
    try {
      await rolesService.remove(role.id);
      loadRoles();
    } catch (err) {
      setError(err.response?.data?.error?.message || "No se pudo eliminar el rol.");
    }
  }

  return (
    <div className="roles-list-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Roles</h2>
        <Link to="/admin/roles/new" className="btn btn-primary btn-sm">
          Nuevo rol
        </Link>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Permisos</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>{role.name}</td>
                <td>{role.permission_codenames.length}</td>
                <td>
                  <div className="d-flex gap-2">
                    <Link to={`/admin/roles/${role.id}`} className="btn btn-outline-secondary btn-sm">
                      Editar
                    </Link>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      onClick={() => handleDelete(role)}
                    >
                      Eliminar
                    </button>
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
    </div>
  );
}
