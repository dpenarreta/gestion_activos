import { Link } from "react-router-dom";

import { Icon } from "../../common/Icon/Icon";
import { hasActiveDescendant } from "./adminMenuTree";

/** Ítem hoja del Menú Administrativo (sin hijos): siempre navega. */
export function AdminMenuItem({ item, isCollapsed, currentPath, onNavigate }) {
  const isActive = hasActiveDescendant(item, currentPath);
  return (
    <li>
      <Link
        to={item.path || "#"}
        className={`mz-nav-item ${isActive ? "is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
        onClick={(event) => onNavigate(event, item.path)}
        title={isCollapsed ? item.name : undefined}
      >
        <Icon name={item.icon} />
        {!isCollapsed && <span className="mz-nav-label">{item.name}</span>}
      </Link>
    </li>
  );
}
