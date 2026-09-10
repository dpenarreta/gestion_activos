import { useState } from "react";
import { Link } from "react-router-dom";

import { adminUsersService } from "../../../api/adminUsersService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { useAdminUsers } from "../../../hooks/useAdminUsers";
import "./UsersList.css";

const STATUS_LABELS = {
  active: "Activo",
  disabled: "Deshabilitado",
  blocked: "Bloqueado",
};

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Usuarios" }];

export function UsersList() {
  const {
    users,
    count,
    hasNext,
    hasPrevious,
    page,
    setPage,
    filters,
    updateFilters,
    isLoading,
    error,
    refresh,
  } = useAdminUsers();
  const [searchInput, setSearchInput] = useState("");
  const [actionError, setActionError] = useState(null);

  function handleSearchSubmit(event) {
    event.preventDefault();
    updateFilters({ q: searchInput });
  }

  async function runAction(user, action) {
    setActionError(null);
    try {
      await adminUsersService[action](user.id);
      refresh();
    } catch (err) {
      setActionError(
        err.response?.data?.error?.message || "No se pudo ejecutar la acción.",
      );
    }
  }

  return (
    <div className="users-list-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Usuarios</h2>
        <Link to="/admin/users/new" className="btn btn-primary btn-sm">
          Nuevo usuario
        </Link>
      </div>

      <form
        onSubmit={handleSearchSubmit}
        className="row g-2 mb-3 users-list-filters"
      >
        <div className="col-auto">
          <input
            className="form-control form-control-sm"
            placeholder="Buscar por nombre, correo o usuario"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
        <div className="col-auto">
          <select
            className="form-select form-select-sm"
            value={filters.status}
            onChange={(event) => updateFilters({ status: event.target.value })}
          >
            <option value="">Todos los estados</option>
            <option value="active">Activo</option>
            <option value="disabled">Deshabilitado</option>
            <option value="blocked">Bloqueado</option>
          </select>
        </div>
        <div className="col-auto">
          <button type="submit" className="btn btn-outline-secondary btn-sm">
            Buscar
          </button>
        </div>
      </form>

      {(error || actionError) && (
        <div className="alert alert-danger">{error || actionError}</div>
      )}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Correo</th>
              <th>Estado</th>
              <th>Empresas</th>
              {/* «Globales» porque los de cada empresa ya van en la columna
                  anterior: sin el adjetivo, un guion aquí se lee como que la
                  cuenta no tiene ningún rol en ninguna parte. */}
              <th>Roles globales</th>
              <th>Creado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.username}
                  {user.is_superuser && (
                    <span className="badge bg-dark ms-2">Administrador</span>
                  )}
                </td>
                <td>{user.email}</td>
                <td>
                  <span
                    className={`badge users-list-status users-list-status--${user.status}`}
                  >
                    {STATUS_LABELS[user.status] || user.status}
                  </span>
                </td>
                <td>
                  {/* A qué organización pertenece y qué hace en cada una: es
                      la primera pregunta al revisar por qué alguien no ve una
                      pantalla, y abrir ficha por ficha la vuelve impracticable. */}
                  {(user.empresas ?? []).length === 0 && (
                    <span className="text-muted">—</span>
                  )}
                  {(user.empresas ?? []).map((empresa) => (
                    <div key={empresa.id} className="users-list-empresa">
                      <span className="fw-semibold">{empresa.nombre}</span>
                      {empresa.es_predeterminada && (
                        <span className="badge text-bg-light ms-1">
                          Predeterminada
                        </span>
                      )}
                      <div className="text-muted">
                        {empresa.roles.map((rol) => rol.name).join(", ") ||
                          "Sin rol"}
                      </div>
                    </div>
                  ))}
                </td>
                <td>{user.roles.map((role) => role.name).join(", ") || "—"}</td>
                <td>{new Date(user.created_at).toLocaleDateString()}</td>
                <td>
                  <div className="d-flex gap-2 flex-wrap">
                    <Link
                      to={`/admin/users/${user.id}`}
                      className="btn btn-outline-primary btn-sm"
                    >
                      Editar
                    </Link>
                    {user.status === "active" ? (
                      <button
                        type="button"
                        className="btn btn-outline-warning btn-sm"
                        onClick={() => runAction(user, "disable")}
                      >
                        Deshabilitar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-outline-success btn-sm"
                        onClick={() => runAction(user, "enable")}
                      >
                        Habilitar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && users.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted">
                  Sin resultados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="d-flex justify-content-between align-items-center">
        <span className="text-muted">{count} usuarios</span>
        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={!hasPrevious}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={!hasNext}
            onClick={() => setPage(page + 1)}
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
