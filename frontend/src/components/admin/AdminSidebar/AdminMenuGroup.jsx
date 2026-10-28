import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Icon } from "../../common/Icon/Icon";
import { AdminMenuItem } from "./AdminMenuItem";
import { hasActiveDescendant } from "./adminMenuTree";

/** Pantalla con mouse y menú de escritorio: donde tiene sentido desplegar al
 * pasar por encima. En el teléfono (menú en cajón) no hay «pasar por
 * encima», y el panel flotante se quedaría abierto tras cada toque. */
const CON_MOUSE = "(hover: hover) and (pointer: fine) and (min-width: 881px)";

/** Lo que tarda en cerrarse el panel al salir del grupo: da tiempo a cruzar
 * el margen entre el ítem y el panel sin que desaparezca a mitad de camino. */
const RETARDO_CIERRE_MS = 180;

export function useConMouse() {
  const [conMouse, setConMouse] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.(CON_MOUSE).matches),
  );
  useEffect(() => {
    const consulta = window.matchMedia?.(CON_MOUSE);
    if (!consulta?.addEventListener) return undefined;
    const alCambiar = () => setConMouse(consulta.matches);
    consulta.addEventListener("change", alCambiar);
    return () => consulta.removeEventListener("change", alCambiar);
  }, []);
  return conMouse;
}

/**
 * Grupo colapsable del Menú Administrativo — recursivo: un hijo con hijos se
 * dibuja como otro grupo, al nivel que haga falta.
 *
 * Dos maneras de llegar a lo de dentro:
 * - **Pulsar** el grupo lo abre en acordeón, debajo (y cierra sus hermanos).
 * - **Pasar el mouse** por un grupo cerrado despliega sus entradas en un panel
 *   al costado del menú, sin moverlo. Con el menú contraído a íconos es la
 *   única forma de verlas: ahí el acordeón no se dibuja.
 *
 * El panel va con `position: fixed` y coordenadas medidas: dentro de la lista
 * del menú —que tiene su propio scroll— un panel absoluto quedaría recortado.
 *
 * Con el menú contraído el panel también se abre **pulsando** el grupo (clic,
 * toque, Enter, Espacio o flecha abajo): antes solo abría con el mouse, y con
 * teclado o en una tableta táctil no había forma de llegar a lo de dentro
 * (auditoría UX/UI, fase 3, 28/10/2026). Abierto así queda fijo: las flechas
 * recorren sus enlaces, Escape lo cierra y devuelve el foco al grupo, y se
 * cierra al salir con Tab o al pulsar fuera.
 */
/** Lo pendiente de todas las entradas del grupo, para su cabecera. */
function totalDeInsignias(item, insignias) {
  return (item.children || []).reduce(
    (total, hijo) =>
      total +
      (hijo.insignia ? (insignias[hijo.insignia] ?? 0) : 0) +
      totalDeInsignias(hijo, insignias),
    0,
  );
}

export function AdminMenuGroup({
  item,
  isCollapsed,
  currentPath,
  onNavigate,
  accordion,
  siblingIds = [],
  nivel = 1,
  insignias = {},
}) {
  const sublistId = useId();
  const flyoutId = useId();
  const botonRef = useRef(null);
  const flyoutRef = useRef(null);
  const cierreRef = useRef(null);
  const conMouse = useConMouse();
  // { top, left, fijo }: `fijo` cuando se abrió pulsando y no al pasar el
  // mouse; ese no se cierra al sacar el puntero.
  const [flyout, setFlyout] = useState(null);
  const enfocarAlAbrir = useRef(false);

  // Los subgrupos hermanos, para que abrir uno cierre al otro sin tocar al
  // padre: pasarle los ids de todos los hijos cerraría el grupo que los
  // contiene en cuanto alguien abriera el de dentro.
  const subgruposHermanos = item.children
    .filter((hijo) => (hijo.children || []).length > 0)
    .map((hijo) => hijo.id);
  const isActive = hasActiveDescendant(item, currentPath);
  const pendientes = totalDeInsignias(item, insignias);
  const isExpanded = accordion.isExpanded(item.id);
  // Solo el primer nivel flota: los de dentro ya se ven en el panel del padre.
  // Abierto en acordeón no hace falta, salvo con el menú contraído, donde el
  // panel es la única manera de verlos (con mouse o sin él).
  const puedeFlotar = nivel === 1 && (isCollapsed || (conMouse && !isExpanded));

  useEffect(() => () => clearTimeout(cierreRef.current), []);
  useEffect(() => {
    if (!puedeFlotar) setFlyout(null);
  }, [puedeFlotar]);

  // Un solo panel abierto a la vez: al abrirse uno, los demás grupos cierran
  // el suyo (auditoría UX/UI, fase 3).
  const yo = useRef({});
  useEffect(() => {
    if (!flyout) return undefined;
    window.dispatchEvent(
      new CustomEvent("mz-flyout-abierto", { detail: yo.current }),
    );
    return undefined;
  }, [flyout]);
  useEffect(() => {
    function otroAbierto(evento) {
      if (evento.detail !== yo.current) setFlyout(null);
    }
    window.addEventListener("mz-flyout-abierto", otroAbierto);
    return () => window.removeEventListener("mz-flyout-abierto", otroAbierto);
  }, []);

  // Que el panel no se salga por abajo: se mide ya dibujado y se sube lo justo.
  useLayoutEffect(() => {
    if (!flyout || !flyoutRef.current) return;
    const alto = flyoutRef.current.offsetHeight;
    const limite = window.innerHeight - 8;
    if (flyout.top + alto > limite) {
      const top = Math.max(8, limite - alto);
      if (top !== flyout.top)
        setFlyout((actual) => actual && { ...actual, top });
    }
  }, [flyout]);

  // Abierto pulsando, el foco pasa a su primer enlace; y un clic fuera lo
  // cierra.
  useEffect(() => {
    if (!flyout?.fijo) return undefined;
    if (enfocarAlAbrir.current) {
      enfocarAlAbrir.current = false;
      flyoutRef.current?.querySelector("a")?.focus();
    }
    function alPulsarFuera(evento) {
      const grupo = botonRef.current?.closest("li");
      if (grupo && !grupo.contains(evento.target)) setFlyout(null);
    }
    document.addEventListener("mousedown", alPulsarFuera);
    return () => document.removeEventListener("mousedown", alPulsarFuera);
  }, [flyout?.fijo]);

  function posicionDelPanel() {
    const boton = botonRef.current.getBoundingClientRect();
    const menu = botonRef.current
      .closest(".mz-sidebar")
      ?.getBoundingClientRect();
    return { top: boton.top, left: (menu?.right ?? boton.right) + 6 };
  }

  function abrirFlyout() {
    clearTimeout(cierreRef.current);
    // Pasar el mouse solo despliega con mouse de verdad: en una pantalla
    // táctil el toque también dispara «mouseenter».
    if (!conMouse || !puedeFlotar || !botonRef.current) return;
    if (flyout?.fijo) return;
    setFlyout({ ...posicionDelPanel(), fijo: false });
  }

  function cerrarFlyout() {
    clearTimeout(cierreRef.current);
    if (flyout?.fijo) return;
    cierreRef.current = setTimeout(() => setFlyout(null), RETARDO_CIERRE_MS);
  }

  /** Contraído, pulsar el grupo abre (o cierra) el panel, fijo. */
  function alternarFlyoutFijo() {
    clearTimeout(cierreRef.current);
    if (flyout?.fijo) {
      setFlyout(null);
      return;
    }
    enfocarAlAbrir.current = true;
    setFlyout({ ...posicionDelPanel(), fijo: true });
  }

  function alPulsarTeclaEnGrupo(evento) {
    if (!isCollapsed || nivel !== 1) return;
    if (evento.key === "ArrowDown" && !flyout?.fijo) {
      evento.preventDefault();
      alternarFlyoutFijo();
    }
  }

  /** Dentro del panel: flechas para recorrer sus enlaces y Escape para
   * volver al grupo. */
  function alPulsarTeclaEnPanel(evento) {
    if (evento.key === "Escape") {
      evento.preventDefault();
      evento.stopPropagation();
      setFlyout(null);
      botonRef.current?.focus();
      return;
    }
    const enlaces = [...(flyoutRef.current?.querySelectorAll("a") ?? [])];
    if (enlaces.length === 0) return;
    const actual = enlaces.indexOf(document.activeElement);
    let siguiente = null;
    if (evento.key === "ArrowDown") siguiente = (actual + 1) % enlaces.length;
    else if (evento.key === "ArrowUp")
      siguiente = (actual - 1 + enlaces.length) % enlaces.length;
    else if (evento.key === "Home") siguiente = 0;
    else if (evento.key === "End") siguiente = enlaces.length - 1;
    if (siguiente === null) return;
    evento.preventDefault();
    enlaces[siguiente].focus();
  }

  /** Al salir del grupo con Tab, el panel fijo se cierra. Sin destino
   * (`relatedTarget` nulo: un clic en el relleno del panel, o Safari, donde
   * los botones no toman el foco) no se cierra: de eso se encarga el clic
   * fuera. */
  function alPerderFoco(evento) {
    if (!flyout?.fijo || !evento.relatedTarget) return;
    if (!evento.currentTarget.contains(evento.relatedTarget)) setFlyout(null);
  }

  function navegarDesdeFlyout(evento, path) {
    setFlyout(null);
    onNavigate(evento, path);
  }

  const headerClassName = [
    "mz-nav-item",
    "mz-nav-group",
    isActive && "is-active",
    isExpanded && "is-expanded",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={nivel > 1 ? "mz-nav-anidado" : undefined}
      onMouseEnter={abrirFlyout}
      onMouseLeave={cerrarFlyout}
      onBlur={alPerderFoco}
    >
      <button
        ref={botonRef}
        type="button"
        className={headerClassName}
        onClick={() => {
          // Contraído no hay acordeón a la vista: se abre el panel.
          if (isCollapsed && nivel === 1) {
            alternarFlyoutFijo();
            return;
          }
          setFlyout(null);
          accordion.toggle(item.id, siblingIds);
        }}
        onKeyDown={alPulsarTeclaEnGrupo}
        aria-expanded={
          isCollapsed && nivel === 1 ? Boolean(flyout) : isExpanded
        }
        aria-controls={isCollapsed && nivel === 1 ? flyoutId : sublistId}
        title={isCollapsed ? item.name : undefined}
      >
        <Icon name={item.icon} />
        {!isCollapsed && <span className="mz-nav-label">{item.name}</span>}
        {!isCollapsed && pendientes > 0 && (
          <span className="mz-badge" title={`${pendientes} pendientes`}>
            {pendientes}
            {/* Texto oculto y no aria-label, que en un <span> sin rol se
                ignora (auditoría UX/UI, fase 3, 28/10/2026). */}
            <span className="visually-hidden"> pendientes</span>
          </span>
        )}
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
                insignias={insignias}
              />
            ) : (
              <AdminMenuItem
                key={child.id}
                item={child}
                isCollapsed={isCollapsed}
                currentPath={currentPath}
                onNavigate={onNavigate}
                insignia={
                  child.insignia ? insignias[child.insignia] : undefined
                }
                tipoInsignia={child.insignia}
              />
            ),
          )}
        </ul>
      </div>

      {flyout && (
        <div
          id={flyoutId}
          ref={flyoutRef}
          className="mz-flyout"
          style={{ top: flyout.top, left: flyout.left }}
          aria-label={item.name}
          role="group"
        >
          <div className="mz-flyout-titulo">{item.name}</div>
          <EntradasDelFlyout
            hijos={item.children}
            currentPath={currentPath}
            onNavigate={navegarDesdeFlyout}
            onTecla={alPulsarTeclaEnPanel}
          />
        </div>
      )}
    </li>
  );
}

/** Las entradas del panel: las hojas como enlaces y los subgrupos como un
 * rótulo con sus hojas debajo, a cualquier profundidad. */
function EntradasDelFlyout({ hijos, currentPath, onNavigate, onTecla }) {
  return (
    <ul className="mz-flyout-lista">
      {hijos.map((hijo) =>
        (hijo.children || []).length > 0 ? (
          <li key={hijo.id} className="mz-flyout-seccion">
            <span className="mz-flyout-rotulo">{hijo.name}</span>
            <EntradasDelFlyout
              hijos={hijo.children}
              currentPath={currentPath}
              onNavigate={onNavigate}
              onTecla={onTecla}
            />
          </li>
        ) : (
          <li key={hijo.id}>
            <Link
              to={hijo.path || "#"}
              className={`mz-flyout-item${
                hasActiveDescendant(hijo, currentPath) ? " is-active" : ""
              }`}
              aria-current={
                hasActiveDescendant(hijo, currentPath) ? "page" : undefined
              }
              onClick={(evento) => onNavigate(evento, hijo.path)}
              onKeyDown={onTecla}
            >
              <Icon name={hijo.icon} />
              <span>{hijo.name}</span>
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}
