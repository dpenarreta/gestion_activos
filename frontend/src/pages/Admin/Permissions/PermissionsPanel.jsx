import { Icon } from "../../../components/common/Icon/Icon";
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
        0,
      )
    : 0;

  return (
    <div className="permissions-page">
      <p className="mz-faint">
        {total > 0 && <strong>{total} permisos</strong>} agrupados por módulo.
        Para otorgarlos, edite un rol en la pestaña <strong>Roles</strong> y
        asígneselo al usuario desde su ficha.
      </p>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {isLoading && <div className="mz-empty">Cargando…</div>}

      {catalog && (
        <div className="mz-stack">
          {Object.entries(catalog).map(([moduleKey, module]) => (
            <section className="mz-card" key={moduleKey}>
              <div className="mz-card-head">
                <div>
                  <h3>{module.label}</h3>
                  <div className="mz-small mz-faint">{module.description}</div>
                </div>
              </div>
              {/* Tabla de permisos de la identidad: el nombre que se lee a la
                  izquierda y, a la derecha, el código con el que el servidor
                  lo reconoce —el que hay que buscar en `catalog.py`—. */}
              <table className="mz-perm-table permissions-page__tabla">
                <thead>
                  <tr>
                    <th>Permiso</th>
                    <th>Código</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(module.permissions).map(
                    ([codename, label]) => (
                      <tr key={codename}>
                        <td>{label}</td>
                        <td className="mz-code">{codename}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
