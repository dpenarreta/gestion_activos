import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { matrizService } from "../../../api/matrizService";

import { env } from "../../../config/env";
import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import { useAdminMenu } from "../../../hooks/useAdminMenu";
import { useAuth } from "../../../hooks/useAuth";
import { useMenuAccordion } from "../../../hooks/useMenuAccordion";
import { useModalA11y } from "../../../hooks/useModalA11y";
import { useTheme } from "../../../hooks/useTheme";
import { iniciales } from "../../../utils/iniciales";
import { Icon } from "../../common/Icon/Icon";
import { AdminMenuGroup } from "./AdminMenuGroup";
import { SelectorModulo } from "../SelectorModulo/SelectorModulo";
import { AdminMenuItem } from "./AdminMenuItem";
import "./AdminSidebar.css";

function rolDe(user) {
  if (user?.is_superuser) return "Superusuario";
  return user?.roles?.[0] || null;
}

/**
 * Menú lateral con el dibujo de la identidad base (`mz-sidebar`): marca,
 * empresa activa, navegación y, al pie, quién está dentro.
 *
 * Consume un árbol estático (ver `staticAdminMenu.js`), filtrado por permiso
 * en el propio cliente además de en el backend. A diferencia de la Matriz
 * conserva los grupos desplegables —aquí hay más de treinta pantallas— y el
 * modo contraído a íconos.
 *
 * En pantallas estrechas es un panel superpuesto que abre la hamburguesa de la
 * barra superior: el estado vive en el layout, que es quien dibuja ese botón.
 */
/**
 * Los contadores de las entradas que llevan insignia. Hoy solo la Matriz: lo
 * incumplido o que vence hoy (`counts.attention`). Se vuelve a pedir al cambiar
 * de pantalla, que es cuando un cierre o un alta pudo moverlo.
 */
function useInsignias(menu, pathname) {
  const conAtencion = menu.some((item) => item.insignia === "atencion");
  const [insignias, setInsignias] = useState({});

  useEffect(() => {
    if (!conAtencion) return undefined;
    let vigente = true;
    matrizService
      .resumen()
      .then((datos) => {
        if (vigente) setInsignias({ atencion: datos.counts.attention });
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [conAtencion, pathname]);

  return insignias;
}

export function AdminSidebar({
  isCollapsed,
  onToggleCollapse,
  isMobileOpen = false,
  onMobileClose = () => {},
  mobileTriggerRef,
}) {
  const menu = useAdminMenu();
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const { isDirty, setIsDirty, guardedNavigate } = useUnsavedChanges();
  const accordion = useMenuAccordion(menu, location.pathname);
  const insignias = useInsignias(menu, location.pathname);
  const operativas = menu.filter((item) => item.modulo !== "comun");
  const generales = menu.filter((item) => item.modulo === "comun");

  function dibujar(item) {
    return item.children && item.children.length > 0 ? (
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
        insignia={insignias[item.insignia]}
      />
    );
  }

  const { panelRef, handleBackdropClick, requestClose } = useModalA11y({
    isOpen: isMobileOpen,
    onRequestClose: onMobileClose,
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
    onMobileClose();
  }

  const [menuUsuario, setMenuUsuario] = useState(false);
  const zonaUsuario = useRef(null);
  useEffect(() => {
    if (!menuUsuario) return undefined;
    function fuera(evento) {
      if (!zonaUsuario.current?.contains(evento.target)) setMenuUsuario(false);
    }
    function tecla(evento) {
      if (evento.key === "Escape") setMenuUsuario(false);
    }
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [menuUsuario]);

  function handleLogout() {
    if (
      isDirty &&
      !window.confirm("Hay cambios sin guardar. ¿Desea continuar sin guardar?")
    ) {
      return;
    }
    setIsDirty(false);
    onMobileClose();
    logout();
  }

  const siteName = theme?.site_name || env.appName;
  const nombreCompleto =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
    user?.username ||
    "";
  const rol = rolDe(user);

  return (
    <>
      <nav
        id="admin-sidebar-nav"
        ref={panelRef}
        className={`mz-sidebar ${isMobileOpen ? "mz-sidebar--open" : ""}`}
        role={isMobileOpen ? "dialog" : undefined}
        aria-modal={isMobileOpen ? "true" : undefined}
        aria-label="Menú administrativo"
        tabIndex={-1}
      >
        <div className="mz-brand">
          <Link
            to="/"
            className="mz-brand-link"
            aria-label={`${siteName} — Ir al inicio`}
          >
            {theme?.logo_url ? (
              <img src={theme.logo_url} alt="" className="mz-brand-logo" />
            ) : (
              <span className="mz-glyph" aria-hidden="true">
                {iniciales(siteName)}
              </span>
            )}
            {!isCollapsed && <span className="mz-brand-name">{siteName}</span>}
          </Link>
          <button
            type="button"
            className="mz-sidebar-close"
            onClick={() => requestClose()}
            aria-label="Cerrar menú administrativo"
          >
            <Icon name="x-lg" />
          </button>
        </div>

        {/* En qué módulo se trabaja, y desde aquí se cambia. La empresa y el
            usuario se ven en la barra superior. */}
        <SelectorModulo isCollapsed={isCollapsed} onElegido={onMobileClose} />

        <ul className="mz-nav">{operativas.map(dibujar)}</ul>

        {/* Lo general del sistema —reportes, configuración, usuarios, roles—
            no es de ningún módulo: va aparte, al pie, igual en todos. */}
        {generales.length > 0 && (
          <div className="mz-nav-general">
            {!isCollapsed && <div className="mz-nav-titulo">General</div>}
            <ul className="mz-nav mz-nav--general">{generales.map(dibujar)}</ul>
          </div>
        )}

        <div className="mz-sidebar-foot">
          {rol && !isCollapsed && (
            <span className="mz-role-pill">
              <Icon name="shield-lock" /> {rol}
            </span>
          )}
          <div className="mz-user mz-user--menu" ref={zonaUsuario}>
            {/* Un clic en el usuario abre su menú: «Mi perfil» (su información
                personal) y cerrar sesión. */}
            <button
              type="button"
              className="mz-user__boton"
              aria-haspopup="menu"
              aria-expanded={menuUsuario}
              aria-label={`Menú de ${nombreCompleto}`}
              onClick={() => setMenuUsuario((abierto) => !abierto)}
            >
              <span
                className="mz-avatar"
                title={isCollapsed ? nombreCompleto : undefined}
              >
                {iniciales(nombreCompleto)}
              </span>
              {!isCollapsed && (
                <span className="mz-user__texto">
                  <strong>{nombreCompleto}</strong>
                  <span>{user?.email}</span>
                </span>
              )}
            </button>
            {menuUsuario && (
              <div className="mz-user__menu" role="menu">
                <Link
                  to="/admin/perfil"
                  role="menuitem"
                  onClick={() => {
                    setMenuUsuario(false);
                    onMobileClose?.();
                  }}
                >
                  <Icon name="person-vcard" /> Mi perfil
                </Link>
                <button type="button" role="menuitem" onClick={handleLogout}>
                  <Icon name="box-arrow-right" /> Cerrar sesión
                </button>
              </div>
            )}
            <button
              type="button"
              className="mz-logout"
              onClick={handleLogout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <Icon name="box-arrow-right" />
            </button>
          </div>
        </div>

        {/* Anclado al borde, a media altura: contraer no es un sitio al que se
            navega, y como último elemento del menú se perdía debajo del pie
            —y quedaba fuera de la pantalla en cuanto el menú era más largo
            que el alto disponible. */}
        <button
          type="button"
          className="mz-collapse-handle"
          onClick={onToggleCollapse}
          aria-pressed={isCollapsed}
          aria-label={isCollapsed ? "Expandir menú" : "Contraer menú"}
          title={isCollapsed ? "Expandir menú" : "Contraer menú"}
        >
          <Icon name={isCollapsed ? "chevron-right" : "chevron-left"} />
        </button>
      </nav>

      {isMobileOpen && (
        <div
          className="mz-sidebar-backdrop"
          onClick={handleBackdropClick}
          aria-hidden="true"
        />
      )}
    </>
  );
}
