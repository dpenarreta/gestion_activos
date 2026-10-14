import { PermissionsPanel } from "../Permissions/PermissionsPanel";
import { RolesPanel } from "./RolesPanel";

/**
 * Roles y catálogo de permisos: dos secciones de Configuración (pestañas
 * «Roles» y «Permisos» del marco) servidas por la misma página.
 *
 * El catálogo de permisos solo se consulta: es una fuente de verdad versionada
 * en código (`backend/apps/permissions/catalog.py`), y lo único que se hace con
 * los permisos —asignarlos— ocurre al editar un rol.
 */
export function RolesPage({ seccion = "roles" }) {
  if (seccion === "permisos") {
    return (
      <div className="roles-page-host">
        <div className="mz-view-head">
          <div>
            <h2>Permisos</h2>
            <p className="mz-desc">
              Lo que se puede conceder, módulo por módulo. Se asignan al editar
              un rol.
            </p>
          </div>
        </div>
        <PermissionsPanel />
      </div>
    );
  }
  return (
    <div className="roles-page-host">
      <div className="mz-view-head">
        <div>
          <h2>Roles</h2>
          <p className="mz-desc">
            Qué puede hacer cada cuenta: los permisos se agrupan en roles y los
            roles se asignan desde la ficha del usuario.
          </p>
        </div>
      </div>
      <RolesPanel />
    </div>
  );
}
