import { usePermissionsCatalog } from "../../../hooks/usePermissionsCatalog";
import "./PermissionsPanel.css";

/**
 * Catálogo de permisos, en solo lectura.
 *
 * Los permisos son una fuente de verdad versionada en código (ver
 * `backend/apps/permissions/catalog.py`), no un recurso editable en runtime:
 * un permiso que no esté en ese archivo no existe para el sistema. Esta vista
 * sirve para consultarlos y saber qué habilita cada uno antes de asignarlo.
 *
 * Es un panel y no una página: vive dentro de la pantalla de Roles, que es
 * donde los permisos efectivamente se asignan.
 */
export function PermissionsPanel() {
  const { catalog, isLoading, error } = usePermissionsCatalog();

  const total = catalog
    ? Object.values(catalog).reduce(
        (suma, modulo) => suma + Object.keys(modulo.permissions).length,
        0
      )
    : 0;

  return (
    <div className="permissions-page">
      <p className="text-muted">
        {total > 0 && <strong>{total} permisos</strong>} agrupados por módulo. Para otorgarlos, edite
        un rol en la pestaña <strong>Roles</strong> y asígneselo al usuario desde su ficha.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}
      {isLoading && <p className="text-muted">Cargando…</p>}

      {catalog &&
        Object.entries(catalog).map(([moduleKey, module]) => (
          <div className="card mb-3 permissions-page__module" key={moduleKey}>
            <div className="card-header">
              <strong>{module.label}</strong>
              <div className="text-muted small">{module.description}</div>
            </div>
            <ul className="list-group list-group-flush">
              {Object.entries(module.permissions).map(([codename, label]) => (
                <li
                  className="list-group-item d-flex justify-content-between align-items-center gap-3"
                  key={codename}
                >
                  {label}
                  <code className="text-muted">{codename}</code>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
