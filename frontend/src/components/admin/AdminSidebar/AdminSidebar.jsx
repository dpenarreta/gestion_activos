import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { env } from "../../../config/env";
import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import { useAdminMenu } from "../../../hooks/useAdminMenu";
import { useAuth } from "../../../hooks/useAuth";
import { useMenuAccordion } from "../../../hooks/useMenuAccordion";
import { useModalA11y } from "../../../hooks/useModalA11y";
import { useTheme } from "../../../hooks/useTheme";
import { Icon } from "../../common/Icon/Icon";
import { AdminMenuGroup } from "./AdminMenuGroup";
import { SelectorEmpresa } from "./SelectorEmpresa";
import { AdminMenuItem } from "./AdminMenuItem";
import "./AdminSidebar.css";

/**
 * Menú principal del panel administrativo, en un sidebar izquierdo.
 * Consume un árbol estático (ver `staticAdminMenu.js`), filtrado por
 * permiso en el propio cliente además de en el backend.
 *
 * Tres modos por CSS: escritorio (expandido/colapsable), tableta (colapsado
 * por defecto), móvil (offcanvas deslizable). El logo se lee directamente
 * de `ThemeContext` (`theme.logo_url`) — sin dependencia de una biblioteca
 * de medios.
 */
export function AdminSidebar({ isCollapsed, onToggleCollapse }) {
  const menu = useAdminMenu();
  const { logout } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const { isDirty, setIsDirty, guardedNavigate } = useUnsavedChanges();

  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const mobileTriggerRef = useRef(null);
  const accordion = useMenuAccordion(menu, location.pathname);

  const { panelRef, handleBackdropClick, requestClose } = useModalA11y({
    isOpen: isMobileOpen,
    onRequestClose: () => setIsMobileOpen(false),
    triggerRef: mobileTriggerRef,
  });

  function handleNavigate(event, path) {
    if (!path) {
      return;
    }
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    guardedNavigate(path);
    setIsMobileOpen(false);
  }

  function handleLogout() {
    if (
      isDirty &&
      !window.confirm("Hay cambios sin guardar. ¿Desea continuar sin guardar?")
    ) {
      return;
    }
    setIsDirty(false);
    setIsMobileOpen(false);
    logout();
  }

  const siteName = theme?.site_name || env.appName;

  return (
    <>
      <button
        type="button"
        ref={mobileTriggerRef}
        className="admin-sidebar__mobile-trigger"
        onClick={() => setIsMobileOpen(true)}
        aria-expanded={isMobileOpen}
        aria-controls="admin-sidebar-nav"
        aria-label="Abrir menú administrativo"
      >
        <span aria-hidden="true">☰</span>
      </button>

      {isMobileOpen && (
        <div
          className="admin-sidebar__backdrop"
          onClick={handleBackdropClick}
          aria-hidden="true"
        />
      )}

      <aside
        id="admin-sidebar-nav"
        ref={panelRef}
        className={`admin-sidebar ${isCollapsed ? "admin-sidebar--collapsed" : ""} ${
          isMobileOpen ? "admin-sidebar--mobile-open" : ""
        }`}
        role={isMobileOpen ? "dialog" : undefined}
        aria-modal={isMobileOpen ? "true" : undefined}
        aria-label="Menú administrativo"
        tabIndex={-1}
      >
        <div className="admin-sidebar__header">
          <Link
            to="/"
            className="admin-sidebar__brand"
            aria-label={`${siteName} — Ir al inicio`}
          >
            {theme?.logo_url ? (
              <img
                src={theme.logo_url}
                alt=""
                className="admin-sidebar__logo"
              />
            ) : null}
            {isCollapsed ? siteName.slice(0, 2).toUpperCase() : siteName}
          </Link>
          <button
            type="button"
            className="admin-sidebar__close-mobile"
            onClick={() => requestClose()}
            aria-label="Cerrar menú administrativo"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* Debajo del logo y encima del menú: es el ámbito de todo lo que
            viene después, y verlo antes de navegar evita el error de mirar el
            inventario equivocado durante un rato. */}
        <SelectorEmpresa isCollapsed={isCollapsed} />

        <nav className="admin-sidebar__nav">
          <ul className="admin-sidebar__list">
            {menu.map((item) =>
              item.children && item.children.length > 0 ? (
                <AdminMenuGroup
                  key={item.id}
                  item={item}
                  isCollapsed={isCollapsed}
                  currentPath={location.pathname}
                  onNavigate={handleNavigate}
                  accordion={accordion}
                  siblingIds={menu.map((sibling) => sibling.id)}
                />
              ) : (
                <AdminMenuItem
                  key={item.id}
                  item={item}
                  isCollapsed={isCollapsed}
                  currentPath={location.pathname}
                  onNavigate={handleNavigate}
                />
              ),
            )}
          </ul>
        </nav>

        <div className="admin-sidebar__footer">
          {/* Con ícono, como el resto del menú: contraído era el único
              elemento dibujado con un carácter suelto en vez de un ícono, y se
              leía como un error tipográfico más que como un botón. */}
          <button
            type="button"
            className="admin-sidebar__logout"
            onClick={handleLogout}
            title={isCollapsed ? "Cerrar sesión" : undefined}
            aria-label={isCollapsed ? "Cerrar sesión" : undefined}
          >
            <Icon name="box-arrow-right" className="admin-sidebar__icon" />
            {!isCollapsed && (
              <span className="admin-sidebar__label">Cerrar sesión</span>
            )}
          </button>
        </div>

        {/* Fuera de la lista y anclado al borde, a media altura: contraer no
            es un sitio al que se navega, y como último elemento del menú se
            perdía debajo de «Cerrar sesión» —y quedaba fuera de la pantalla
            en cuanto el menú era más largo que el alto disponible. */}
        <button
          type="button"
          className="admin-sidebar__toggle-collapse"
          onClick={onToggleCollapse}
          aria-pressed={isCollapsed}
          aria-label={isCollapsed ? "Expandir menú" : "Contraer menú"}
          title={isCollapsed ? "Expandir menú" : "Contraer menú"}
        >
          <i
            className={`bi ${isCollapsed ? "bi-chevron-right" : "bi-chevron-left"}`}
            aria-hidden="true"
          />
        </button>
      </aside>
    </>
  );
}
