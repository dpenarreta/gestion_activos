import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermissionsCatalog } from "../../../hooks/usePermissionsCatalog";
import "./PermissionsPage.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Permisos" }];

/**
 * Vista de solo lectura del catálogo de permisos: los permisos son una
 * fuente de verdad versionada en código (ver
 * backend/apps/permissions/catalog.py), no un recurso editable en runtime.
 * Asignarlos a un rol se hace desde Roles; asignar permisos individuales a
 * un usuario puntual se hace desde la ficha de ese usuario.
 */
export function PermissionsPage() {
  const { catalog, isLoading, error } = usePermissionsCatalog();

  return (
    <div className="permissions-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2>Permisos</h2>
      <p className="text-muted">
        Catálogo de permisos disponibles en el sistema, agrupados por módulo. Para asignarlos a
        usuarios, hacelo desde un rol en <strong>Administración &gt; Roles</strong>.
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
                <li className="list-group-item d-flex justify-content-between align-items-center" key={codename}>
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
