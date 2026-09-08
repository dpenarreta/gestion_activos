import { Link } from "react-router-dom";

import { Icon } from "../../common/Icon/Icon";
import { hasActiveDescendant } from "./adminMenuTree";

/** Ítem hoja del Menú Administrativo (sin hijos): siempre navega. */
export function AdminMenuItem({ item, isCollapsed, currentPath, onNavigate }) {
  const isActive = hasActiveDescendant(item, currentPath);
  return (
    <li className="admin-sidebar__item">
      <Link
        to={item.path || "#"}
        className={`admin-sidebar__link ${isActive ? "admin-sidebar__link--active" : ""}`}
        onClick={(event) => onNavigate(event, item.path)}
        title={isCollapsed ? item.name : undefined}
      >
        <Icon name={item.icon} className="admin-sidebar__icon" />
        {!isCollapsed && <span className="admin-sidebar__label">{item.name}</span>}
      </Link>
    </li>
  );
}
