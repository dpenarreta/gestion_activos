import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { useAppearance } from "../../../context/AppearanceContext";
import { UnsavedChangesProvider } from "../../../context/UnsavedChangesContext";
import { useAdminMenu } from "../../../hooks/useAdminMenu";
import { useBreakpoint } from "../../../hooks/useBreakpoint";
import { EstadoModulosProvider } from "../../../modulos/EstadoModulos";
import { Icon } from "../../common/Icon/Icon";
import { AdminSidebar } from "../AdminSidebar/AdminSidebar";
import { coincidencia } from "../AdminSidebar/adminMenuTree";
import {
  SelectorEmpresa,
  useMisEmpresas,
} from "../AdminSidebar/SelectorEmpresa";
import { BusquedaGlobal } from "../BusquedaGlobal/BusquedaGlobal";
import { AvisoInicioSesion } from "../AvisoInicioSesion/AvisoInicioSesion";
import { AvisoOnboarding } from "../AvisoOnboarding/AvisoOnboarding";
import { AvisoPerfil } from "../AvisoPerfil/AvisoPerfil";
import { ModuloApagado } from "../ModuloApagado/ModuloApagado";
import { ChatProvider } from "../Chat/ChatContext";
import { ChatDock } from "../Chat/ChatDock";
import { CampanaNotificaciones } from "../Notificaciones/CampanaNotificaciones";
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
  const [avisoListo, setAvisoListo] = useState(false);
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
      <EstadoModulosProvider>
        <ChatProvider>
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
                {/* Soporte TI: toda persona con sesión pide ayuda desde aquí, tenga el
                rol que tenga. */}

                <Link
                  to="/admin/ayuda"
                  className="mz-icon-btn mz-topbar__soporte"
                  title="Soporte TI: pedir ayuda y ver mis tickets"
                >
                  {/* El texto antes del ícono: el audífono solo no se
                      reconocía como «pedir ayuda». En el teléfono queda solo
                      el ícono (el texto sigue para el lector de pantalla). */}
                  <span className="mz-topbar__soporte-texto">Soporte TI</span>
                  <Icon name="headset" />
                </Link>

                <CampanaNotificaciones />
                <BotonTema />
                {/* Con una sola empresa no hay nada que elegir ni mostrar. */}
                {empresas.multiempresa && (
                  <SelectorEmpresa
                    empresas={empresas.empresas}
                    activa={empresas.activa}
                  />
                )}
              </header>
              {/* Con el chat acoplado abajo a la derecha, el contenido deja
                espacio al final: si no, el botón del chat tapa el último botón
                de la pantalla (el «Guardar» de Configuración). */}
              <main
                className={`mz-view${
                  location.pathname.startsWith("/admin/chat")
                    ? ""
                    : " mz-view--con-chat"
                }`}
              >
                <AvisoOnboarding />
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
                  <ModuloApagado>
                    <Outlet />
                  </ModuloApagado>
                )}
              </main>
            </div>
          </div>
          <ChatDock />
          {/* Primero el aviso importante de la empresa; cerrado (o si no hay),
            el de completar «Mi perfil»: uno a la vez, nunca uno encima del
            otro. */}
          <AvisoInicioSesion onTerminado={() => setAvisoListo(true)} />
          {avisoListo && <AvisoPerfil />}
        </ChatProvider>
      </EstadoModulosProvider>
    </UnsavedChangesProvider>
  );
}
