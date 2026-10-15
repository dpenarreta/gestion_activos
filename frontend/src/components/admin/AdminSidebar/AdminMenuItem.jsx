import { Link } from "react-router-dom";

import { Icon } from "../../common/Icon/Icon";
import { hasActiveDescendant } from "./adminMenuTree";

/** Ítem hoja del Menú Administrativo (sin hijos): siempre navega. Con
 * `insignia`, un contador a la derecha (la Matriz: lo que pide atención). */
export function AdminMenuItem({
  item,
  isCollapsed,
  currentPath,
  onNavigate,
  insignia,
}) {
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
        {insignia > 0 && (
          <span
            className="mz-badge"
            title="Incumplidas o que vencen hoy"
            aria-label={`${insignia} que piden atención`}
          >
            {insignia}
          </span>
        )}
      </Link>
    </li>
  );
}
