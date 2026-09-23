import { useId } from "react";

import { Icon } from "../../common/Icon/Icon";
import { AdminMenuItem } from "./AdminMenuItem";
import { hasActiveDescendant } from "./adminMenuTree";

/**
 * Grupo colapsable del Menú Administrativo — recursivo: un hijo con hijos se
 * dibuja como otro grupo, al nivel que haga falta. Hoy el árbol llega a tres
 * («Configuración → Organización → Sedes»).
 *
 * Sin flyout emergente cuando el sidebar está totalmente colapsado (solo
 * íconos): ahí los sublistados no se dibujan —los esconde el CSS—, así que la
 * profundidad no se nota y basta con expandir en línea. Lo que sí exige el
 * tercer nivel es sangrarlo, o los seis catálogos se leerían como hermanos de
 * «Identidad» (ver `AdminSidebar.css`).
 */
export function AdminMenuGroup({
  item,
  isCollapsed,
  currentPath,
  onNavigate,
  accordion,
  siblingIds = [],
  nivel = 1,
}) {
  const sublistId = useId();
  // Los subgrupos hermanos, para que abrir uno cierre al otro sin tocar al
  // padre: pasarle los ids de todos los hijos cerraría el grupo que los
  // contiene en cuanto alguien abriera el de dentro.
  const subgruposHermanos = item.children
    .filter((hijo) => (hijo.children || []).length > 0)
    .map((hijo) => hijo.id);
  const isActive = hasActiveDescendant(item, currentPath);
  const isExpanded = accordion.isExpanded(item.id);

  const headerClassName = [
    "admin-sidebar__group-label",
    isActive && "admin-sidebar__group-label--active",
    isExpanded && "admin-sidebar__group-label--expanded",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={`admin-sidebar__item admin-sidebar__item--group ${
        nivel > 1 ? "admin-sidebar__item--anidado" : ""
      }`}
    >
      <div className="admin-sidebar__group-header">
        <button
          type="button"
          className={headerClassName}
          onClick={() => accordion.toggle(item.id, siblingIds)}
          aria-expanded={isExpanded}
          aria-controls={sublistId}
          title={isCollapsed ? item.name : undefined}
        >
          <Icon name={item.icon} className="admin-sidebar__icon" />
          {!isCollapsed && (
            <span className="admin-sidebar__label">{item.name}</span>
          )}
          {!isCollapsed && (
            <Icon
              name="chevron-right"
              className={`admin-sidebar__chevron ${isExpanded ? "admin-sidebar__chevron--expanded" : ""}`}
            />
          )}
        </button>
      </div>

      <div
        className={`admin-sidebar__sublist-wrapper ${isExpanded ? "admin-sidebar__sublist-wrapper--expanded" : ""}`}
      >
        <ul
          id={sublistId}
          className="admin-sidebar__sublist"
          {...(isExpanded ? {} : { inert: "" })}
        >
          {item.children.map((child) =>
            (child.children || []).length > 0 ? (
              <AdminMenuGroup
                key={child.id}
                item={child}
                isCollapsed={isCollapsed}
                currentPath={currentPath}
                onNavigate={onNavigate}
                accordion={accordion}
                siblingIds={subgruposHermanos}
                nivel={nivel + 1}
              />
            ) : (
              <AdminMenuItem
                key={child.id}
                item={child}
                isCollapsed={isCollapsed}
                currentPath={currentPath}
                onNavigate={onNavigate}
              />
            ),
          )}
        </ul>
      </div>
    </li>
  );
}
