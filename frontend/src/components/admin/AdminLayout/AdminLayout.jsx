import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { useAppearance } from "../../../context/AppearanceContext";
import { UnsavedChangesProvider } from "../../../context/UnsavedChangesContext";
import { useAdminMenu } from "../../../hooks/useAdminMenu";
import { useBreakpoint } from "../../../hooks/useBreakpoint";
import { Icon } from "../../common/Icon/Icon";
import { AdminSidebar } from "../AdminSidebar/AdminSidebar";
import { coincidencia } from "../AdminSidebar/adminMenuTree";
import {
  SelectorEmpresa,
  useMisEmpresas,
} from "../AdminSidebar/SelectorEmpresa";
import { BusquedaGlobal } from "../BusquedaGlobal/BusquedaGlobal";
import {
  AuditoriaMarco,
  esRutaDeAuditoria,
} from "../AuditoriaMarco/AuditoriaMarco";
import { ConfiguracionMarco } from "../ConfiguracionMarco/ConfiguracionMarco";
import { seccionDeRuta } from "../ConfiguracionMarco/seccionesConfiguracion";
import {
  ReportesMarco,
  esRutaDeReportes,
} from "../ReportesMarco/ReportesMarco";
import { SelectorModulo } from "../SelectorModulo/SelectorModulo";
import "./AdminLayout.css";

const COLLAPSE_STORAGE_KEY = "admin.sidebar.collapsed";

function hasStoredPreference() {
  return localStorage.getItem(COLLAPSE_STORAGE_KEY) !== null;
}

function getInitialCollapsed(breakpoint) {
  const stored = localStorage.getItem(COLLAPSE_STORAGE_KEY);
  if (stored !== null) {
    return stored === "true";
  }
  return breakpoint === "md" || breakpoint === "lg";
}

/**
 * El título de la barra superior: la entrada del menú que corresponde a la
 * ruta actual, la más específica. `/admin/activos/42` cae en «Inventario»,
 * que es de donde se llegó a esa ficha.
 */
export function tituloDeRuta(menu, pathname) {
  let mejor = null;
  let largo = 0;
  function recorrer(items) {
    for (const item of items) {
      const ruta = coincidencia(item, pathname);
      if (ruta && ruta.length > largo) {
        mejor = item;
        largo = ruta.length;
      }
      recorrer(item.children || []);
    }
  }
  recorrer(menu);
  return mejor?.name || "";
}

/** Claro u oscuro con un clic, como en la identidad base. La opción «según el
 * sistema» sigue en Configuración → Apariencia. */
function BotonTema() {
  const { resolvedTheme, setMode } = useAppearance();
  const esOscuro = resolvedTheme === "dark";
  const etiqueta = esOscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  return (
    <button
      type="button"
      className="mz-icon-btn"
      onClick={() => setMode(esOscuro ? "light" : "dark")}
      aria-label={etiqueta}
      title={etiqueta}
    >
      <Icon name={esOscuro ? "sun" : "moon-stars"} />
    </button>
  );
}

/**
 * Shell de todo `/admin/*` con la estructura de la identidad base: menú
 * lateral (`mz-sidebar`) y, a la derecha, barra superior (`mz-topbar`) más
 * la vista (`mz-view`). Provee `UnsavedChangesContext` una única vez para todo
 * el árbol admin.
 */
export function AdminLayout() {
  const breakpoint = useBreakpoint();
  const location = useLocation();
  const menu = useAdminMenu();
  const empresas = useMisEmpresas();
  const [isCollapsed, setIsCollapsed] = useState(() =>
    getInitialCollapsed(breakpoint),
  );
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const mobileTriggerRef = useRef(null);
  const hadStoredPreference = useRef(hasStoredPreference());

  useEffect(() => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    if (!hadStoredPreference.current) {
      setIsCollapsed(breakpoint === "md" || breakpoint === "lg");
    }
  }, [breakpoint]);

  function handleToggleCollapse() {
    hadStoredPreference.current = true;
    setIsCollapsed((value) => !value);
  }

  return (
    <UnsavedChangesProvider>
      <div
        className={`mz-shell ${isCollapsed ? "mz-shell--collapsed" : ""}`}
        style={
          empresas.activa?.color
            ? { "--company-color": empresas.activa.color }
            : undefined
        }
      >
        <AdminSidebar
          isCollapsed={isCollapsed}
          onToggleCollapse={handleToggleCollapse}
          isMobileOpen={isMobileOpen}
          onMobileClose={() => setIsMobileOpen(false)}
          mobileTriggerRef={mobileTriggerRef}
          empresas={empresas}
        />
        <div className="mz-main">
          {/* La búsqueda vive aquí y no dentro de cada pantalla: buscar un
              equipo es lo que más se hace, y tenerlo en un solo sitio evita
              que cada listado se invente su propia versión. */}
          <header className="mz-topbar">
            <button
              type="button"
              ref={mobileTriggerRef}
              className="mz-icon-btn mz-menu-btn"
              onClick={() => setIsMobileOpen(true)}
              aria-expanded={isMobileOpen}
              aria-controls="admin-sidebar-nav"
              aria-label="Abrir menú administrativo"
            >
              <Icon name="list" />
            </button>
            <h1>{tituloDeRuta(menu, location.pathname)}</h1>
            <div className="mz-spacer" />
            <BusquedaGlobal />
            <BotonTema />
            <SelectorModulo />
            <SelectorEmpresa
              empresas={empresas.empresas}
              activa={empresas.activa}
            />
          </header>
          <main className="mz-view">
            {/* Las secciones de Configuración conservan sus rutas de
                siempre; el marco con sus pestañas se pone aquí, según dónde
                se esté, y no en cada pantalla. */}
            {seccionDeRuta(location.pathname) ? (
              <ConfiguracionMarco empresa={empresas.activa?.nombre}>
                <Outlet />
              </ConfiguracionMarco>
            ) : esRutaDeAuditoria(location.pathname) ? (
              <AuditoriaMarco>
                <Outlet />
              </AuditoriaMarco>
            ) : esRutaDeReportes(location.pathname) ? (
              <ReportesMarco>
                <Outlet />
              </ReportesMarco>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </UnsavedChangesProvider>
  );
}
