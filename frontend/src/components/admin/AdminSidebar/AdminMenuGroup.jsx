import { useId } from "react";

import { Icon } from "../../common/Icon/Icon";
import { AdminMenuItem } from "./AdminMenuItem";
import { hasActiveDescendant } from "./adminMenuTree";

/**
 * Grupo colapsable del Menú Administrativo — recursivo. Versión
 * simplificada respecto del proyecto original del que se particionó la
 * plantilla base: sin flyout emergente cuando el sidebar está totalmente
 * colapsado (solo íconos) — con el árbol acotado de esta base (2
 * niveles como máximo) alcanza con expandir en línea igual que expandido,
 * evitando sumar ese componente adicional.
 */
export function AdminMenuGroup({ item, isCollapsed, currentPath, onNavigate, accordion, siblingIds = [] }) {
  const sublistId = useId();
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
    <li className="admin-sidebar__item admin-sidebar__item--group">
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
          {!isCollapsed && <span className="admin-sidebar__label">{item.name}</span>}
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
        <ul id={sublistId} className="admin-sidebar__sublist" {...(isExpanded ? {} : { inert: "" })}>
          {item.children.map((child) => (
            <AdminMenuItem
              key={child.id}
              item={child}
              isCollapsed={isCollapsed}
              currentPath={currentPath}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </div>
    </li>
  );
}
