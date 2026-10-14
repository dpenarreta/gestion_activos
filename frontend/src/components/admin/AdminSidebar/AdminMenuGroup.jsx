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
    "mz-nav-item",
    "mz-nav-group",
    isActive && "is-active",
    isExpanded && "is-expanded",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={nivel > 1 ? "mz-nav-anidado" : undefined}>
      <button
        type="button"
        className={headerClassName}
        onClick={() => accordion.toggle(item.id, siblingIds)}
        aria-expanded={isExpanded}
        aria-controls={sublistId}
        title={isCollapsed ? item.name : undefined}
      >
        <Icon name={item.icon} />
        {!isCollapsed && <span className="mz-nav-label">{item.name}</span>}
        {!isCollapsed && (
          <Icon name="chevron-right" className="mz-nav-chevron" />
        )}
      </button>

      <div
        className={`mz-subnav-wrap ${isExpanded ? "mz-subnav-wrap--open" : ""}`}
      >
        <ul
          id={sublistId}
          className="mz-subnav"
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
