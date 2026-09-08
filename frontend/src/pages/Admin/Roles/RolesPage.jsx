import { AdminTabs } from "../../../components/admin/AdminTabs/AdminTabs";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { PermissionsPanel } from "../Permissions/PermissionsPanel";
import { RolesPanel } from "./RolesPanel";

const TABS = [
  { key: "roles", label: "Roles", path: "/admin/roles" },
  { key: "permisos", label: "Catálogo de permisos", path: "/admin/roles/permisos" },
];

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Roles y permisos" }];

/**
 * Host del módulo de roles, con el catálogo de permisos como segunda pestaña.
 *
 * Los permisos dejaron de ser una entrada propia del menú porque no son un
 * recurso que se administre por separado: son una fuente de verdad versionada
 * en código (`backend/apps/permissions/catalog.py`) que solo se consulta, y lo
 * único que se hace con ellos —asignarlos— ocurre al editar un rol. Tenerlos
 * como sección independiente sugería una gestión que no existe.
 */
export function RolesPage({ seccion = "roles" }) {
  return (
    <div className="roles-page-host">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2>Roles y permisos</h2>
      <AdminTabs tabs={TABS} />

      <div
        role="tabpanel"
        id={`admin-tabpanel-${seccion}`}
        aria-labelledby={`admin-tab-${seccion}`}
        className="pt-3"
      >
        {seccion === "permisos" ? <PermissionsPanel /> : <RolesPanel />}
      </div>
    </div>
  );
}
