import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { usePermission } from "../../hooks/usePermission";
import { mensajeDeError } from "../../utils/errores";
import {
  arbolDeCargos,
  armarArbol,
  nombreDeCargo,
  totalesDe,
} from "./organigrama";

const VISTA = "organigrama.vista";

function vistaGuardada() {
  try {
    return localStorage.getItem(VISTA) === "lista" ? "lista" : "arbol";
  } catch {
    return "arbol";
  }
}
import { NivelDeCargo, NivelesDeCargo } from "./NivelDeCargo";
import "./Institucional.css";

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;
const PASO = 0.1;

const acotar = (valor) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(valor * 100) / 100));

/**
 * El marco del árbol, con su propio zoom: acercar o alejar cambia solo lo que
 * está dentro, no la página. Botones +/−, «Ajustar» (todo el árbol a lo ancho
 * del marco) y «100 %»; Ctrl + rueda acerca o aleja, y arrastrar con el mouse
 * mueve el árbol dentro del marco.
 */
function Lienzo({ children }) {
  const marco = useRef(null);
  const contenido = useRef(null);
  const arrastre = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [arrastrando, setArrastrando] = useState(false);

  // Ctrl + rueda: el listener va a mano porque React registra la rueda como
  // pasiva y así no se podría evitar el zoom de toda la página.
  useEffect(() => {
    const nodo = marco.current;
    if (!nodo) return undefined;
    function rueda(evento) {
      if (!evento.ctrlKey && !evento.metaKey) return;
      evento.preventDefault();
      setZoom((z) => acotar(z + (evento.deltaY < 0 ? PASO : -PASO)));
    }
    nodo.addEventListener("wheel", rueda, { passive: false });
    return () => nodo.removeEventListener("wheel", rueda);
  }, []);

  function ajustar() {
    if (!marco.current || !contenido.current) return;
    const ancho = contenido.current.offsetWidth / zoom;
    if (ancho > 0) setZoom(acotar((marco.current.clientWidth - 16) / ancho));
  }

  function teclado(evento) {
    if (evento.key === "+" || evento.key === "=")
      setZoom((z) => acotar(z + PASO));
    else if (evento.key === "-") setZoom((z) => acotar(z - PASO));
    else if (evento.key === "0") setZoom(1);
  }

  function empezar(evento) {
    if (evento.button !== 0 || evento.target.closest("button, a, input"))
      return;
    arrastre.current = {
      x: evento.clientX,
      y: evento.clientY,
      izquierda: marco.current.scrollLeft,
      arriba: marco.current.scrollTop,
    };
    setArrastrando(true);
  }

  function mover(evento) {
    if (!arrastre.current) return;
    marco.current.scrollLeft =
      arrastre.current.izquierda - (evento.clientX - arrastre.current.x);
    marco.current.scrollTop =
      arrastre.current.arriba - (evento.clientY - arrastre.current.y);
  }

  function soltar() {
    arrastre.current = null;
    setArrastrando(false);
  }

  return (
    <div className="org-marco">
      <div
        className="org-zoom"
        role="toolbar"
        aria-label="Zoom del organigrama"
      >
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          aria-label="Alejar"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => setZoom((z) => acotar(z - PASO))}
        >
          <Icon name="zoom-out" />
        </button>
        <span className="org-zoom__valor" aria-live="polite">
          {Math.round(zoom * 100)} %
        </span>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          aria-label="Acercar"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => setZoom((z) => acotar(z + PASO))}
        >
          <Icon name="zoom-in" />
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={ajustar}
        >
          <Icon name="arrows-angle-contract" /> Ajustar
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={zoom === 1}
          onClick={() => setZoom(1)}
        >
          100 %
        </button>
        <span className="org-zoom__ayuda mz-faint">
          Ctrl + rueda para acercar · arrastre para moverse
        </span>
      </div>
      {/* Una región desplazable debe poder enfocarse (WCAG 2.1.1): con el
          teclado se recorre con las flechas y se acerca o aleja con + y −. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={marco}
        className={`org-lienzo${arrastrando ? " org-lienzo--arrastrando" : ""}`}
        role="region"
        aria-label="Árbol del organigrama"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onKeyDown={teclado}
        onMouseDown={empezar}
        onMouseMove={mover}
        onMouseUp={soltar}
        onMouseLeave={soltar}
      >
        <div ref={contenido} className="org-escala" style={{ zoom }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Cargo({ cargo, cargos, conPersonas }) {
  const jefe = cargos.find((c) => c.id === cargo.jefe);
  return (
    <li className="org-cargo">
      <div className="org-cargo__cabecera">
        <span className="org-cargo__titulo">
          <strong>{cargo.nombre}</strong>
          <NivelDeCargo valor={cargo.nivel} compacto />
        </span>
        <span
          className={`org-plazas${cargo.vacantes > 0 ? " org-plazas--vacante" : ""}`}
          title={`${cargo.plazas - cargo.vacantes} de ${cargo.plazas} plazas cubiertas`}
        >
          {cargo.plazas - cargo.vacantes}/{cargo.plazas}
        </span>
      </div>
      {jefe && <span className="org-cargo__jefe">Reporta a {jefe.nombre}</span>}
      {conPersonas && (
        <ul className="org-personas">
          {cargo.ocupantes.map((p) => (
            <li
              key={p.id}
              className={p.sin_cuenta ? "org-personas__sin-cuenta" : undefined}
              title={
                p.sin_cuenta
                  ? "Cargada desde la plantilla; todavía no tiene cuenta en el sistema"
                  : undefined
              }
            >
              <Icon name={p.sin_cuenta ? "person-dash" : "person"} /> {p.nombre}
              {p.sin_cuenta && (
                <span className="org-personas__etiqueta">sin cuenta</span>
              )}
            </li>
          ))}
          {cargo.vacantes > 0 && (
            <li className="org-personas__vacante">
              {cargo.vacantes === 1
                ? "1 plaza vacante"
                : `${cargo.vacantes} plazas vacantes`}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** Las personas de un cargo, en una tarjeta del árbol. */
function PersonasDelCargo({ cargo }) {
  return (
    <ul className="org-nodo__personas">
      {cargo.ocupantes.map((p) => (
        <li
          key={p.id}
          className={p.sin_cuenta ? "org-personas__sin-cuenta" : undefined}
          title={
            p.sin_cuenta
              ? "Cargada desde la plantilla; todavía no tiene cuenta en el sistema"
              : undefined
          }
        >
          {p.nombre}
        </li>
      ))}
      {cargo.vacantes > 0 && (
        <li className="org-personas__vacante">
          {cargo.vacantes === 1
            ? "1 plaza vacante"
            : `${cargo.vacantes} plazas vacantes`}
        </li>
      )}
    </ul>
  );
}

/** Un cargo del árbol con, debajo y uno al lado del otro, los que le
 * reportan. El color del borde dice su nivel dentro del área. */
function RamaCargo({ rama, conPersonas }) {
  const { cargo, profundidad, hijos } = rama;
  const nivel = Math.min(profundidad, 3);
  const nivelDelCargo = useContext(NivelesDeCargo).find(
    (n) => n.valor === cargo.nivel,
  )?.nombre;
  return (
    <li className="org-ct__rama">
      <div
        className={`org-nodo org-nodo--nivel-${nivel}`}
        aria-label={`${cargo.nombre}${nivelDelCargo ? ` (${nivelDelCargo})` : ""}: ${cargo.ocupantes.map((p) => p.nombre).join(", ") || "vacante"}`}
      >
        <strong className="org-nodo__cargo">{cargo.nombre}</strong>
        <NivelDeCargo valor={cargo.nivel} compacto />
        {cargo.plazas > 1 && (
          <span
            className={`org-plazas${cargo.vacantes > 0 ? " org-plazas--vacante" : ""}`}
            title={`${cargo.plazas - cargo.vacantes} de ${cargo.plazas} plazas cubiertas`}
          >
            {cargo.plazas - cargo.vacantes}/{cargo.plazas}
          </span>
        )}
        {conPersonas && <PersonasDelCargo cargo={cargo} />}
      </div>
      {hijos.length > 0 && (
        <ul className="org-ct">
          {hijos.map((h) => (
            <RamaCargo key={h.cargo.id} rama={h} conPersonas={conPersonas} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Unidad({ nodo, cargos, conPersonas, cerradas, alternar, vista }) {
  const cerrada = cerradas.has(nodo.id);
  const totales = totalesDe(nodo);
  return (
    <li className="org-rama">
      <section
        className={`org-unidad${nodo.activa ? "" : " org-unidad--inactiva"}${
          vista === "arbol" && nodo.cargos.length ? " org-unidad--arbol" : ""
        }`}
        aria-label={nodo.nombre}
      >
        <header className="org-unidad__cabecera">
          <small>{nodo.nivel?.nombre ?? "Sin nivel"}</small>
          <strong>{nodo.nombre}</strong>
        </header>
        {nodo.cargos.length > 0 && vista === "arbol" ? (
          <div className="org-ct__marco">
            <ul className="org-ct org-ct--raiz">
              {arbolDeCargos(nodo.cargos).map((rama) => (
                <RamaCargo
                  key={rama.cargo.id}
                  rama={rama}
                  conPersonas={conPersonas}
                />
              ))}
            </ul>
          </div>
        ) : nodo.cargos.length > 0 ? (
          <ul className="org-cargos">
            {nodo.cargos.map((c) => (
              <Cargo
                key={c.id}
                cargo={c}
                cargos={cargos}
                conPersonas={conPersonas}
              />
            ))}
          </ul>
        ) : (
          <p className="org-unidad__vacia">Sin cargos</p>
        )}
        {nodo.hijas.length > 0 && (
          <button
            type="button"
            className="org-unidad__alternar"
            aria-expanded={!cerrada}
            onClick={() => alternar(nodo.id)}
          >
            <Icon name={cerrada ? "plus-square" : "dash-square"} />
            {cerrada
              ? `Ver ${nodo.hijas.length} unidad(es) · ${totales.plazas} plazas`
              : "Contraer"}
          </button>
        )}
      </section>
      {nodo.hijas.length > 0 && !cerrada && (
        <ul className="org-hijas">
          {nodo.hijas.map((hija) => (
            <Unidad
              key={hija.id}
              nodo={hija}
              cargos={cargos}
              conPersonas={conPersonas}
              cerradas={cerradas}
              alternar={alternar}
              vista={vista}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Institucional → Organigrama: el árbol de la empresa, unidad por unidad, con
 * sus cargos, a quién reporta cada uno, quién lo ocupa y cuántas plazas
 * quedan vacantes. Cada rama se contrae para leer organigramas grandes.
 */
export function OrganigramaPage() {
  // El botón a la estructura se ve con su permiso: armarla (`editar`) o
  // asignar cargos (`asignar`, que abre solo esa pestaña).
  const puedeEditar = usePermission("institucional.editar");
  const puedeAsignar = usePermission("institucional.asignar");
  const puedePerfiles = usePermission("institucional.perfil_cargo");
  const puedeHerramientas = usePermission("herramientas.gestionar");
  const puedeCapacitacion = usePermission("capacitacion.gestionar");
  const puedeResultados = usePermission("capacitacion.resultados");
  // A Editar estructura se entra por la primera pestaña que se pueda abrir.
  const entrada = [
    [puedeEditar, "", "Editar estructura", "diagram-3"],
    [puedeAsignar, "asignaciones", "Asignar cargos", "person-badge"],
    [puedePerfiles, "perfiles", "Perfiles de cargo", "card-checklist"],
    [puedeHerramientas, "herramientas", "Herramientas y licencias", "tools"],
    [puedeCapacitacion, "capacitacion", "Capacitación", "mortarboard"],
    [puedeResultados, "resultados", "Resultados de capacitación", "graph-up"],
  ]
    .filter(([puede]) => puede)
    .map(([, pestana, texto, icono]) => ({ pestana, texto, icono }))[0];
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [conPersonas, setConPersonas] = useState(true);
  const [cerradas, setCerradas] = useState(() => new Set());
  const [buscar, setBuscar] = useState("");
  // Los cargos de cada unidad: árbol por niveles (como un organigrama) o
  // lista. Se recuerda en este navegador.
  const [vista, setVista] = useState(vistaGuardada);

  function cambiarVista(nueva) {
    setVista(nueva);
    try {
      localStorage.setItem(VISTA, nueva);
    } catch {
      /* Sin almacenamiento: vale solo en esta visita. */
    }
  }

  const cargar = () =>
    institucionalService
      .organigrama()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el organigrama.")),
      );

  useEffect(() => {
    cargar();
  }, []);

  const arbol = useMemo(() => (datos ? armarArbol(datos) : []), [datos]);
  // El servidor dice qué se ve: toda la empresa o solo el área de su cargo.
  const alcance = datos?.alcance ?? { tipo: "empresa" };
  const deSuArea = alcance.tipo === "area";
  const totales = useMemo(
    () =>
      arbol.map(totalesDe).reduce(
        (s, t) => ({
          plazas: s.plazas + t.plazas,
          vacantes: s.vacantes + t.vacantes,
        }),
        { plazas: 0, vacantes: 0 },
      ),
    [arbol],
  );
  const encontrados = useMemo(() => {
    const texto = buscar.trim().toLowerCase();
    if (!texto || !datos) return [];
    return datos.cargos
      .filter(
        (c) =>
          c.nombre.toLowerCase().includes(texto) ||
          c.ocupantes.some((p) => p.nombre.toLowerCase().includes(texto)),
      )
      .slice(0, 12);
  }, [buscar, datos]);

  function alternar(id) {
    setCerradas((actual) => {
      const nuevas = new Set(actual);
      if (nuevas.has(id)) nuevas.delete(id);
      else nuevas.add(id);
      return nuevas;
    });
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Organigrama</h2>
          <p className="mz-desc">
            {deSuArea
              ? `Su área: ${alcance.unidad?.nombre ?? "sin cargo asignado"}, las unidades que dependen de ella, sus cargos, a quién reportan y quién los ocupa.`
              : "La estructura de la empresa: sus unidades, los cargos de cada una, a quién reportan y quién los ocupa."}
          </p>
        </div>
        {entrada && (
          <div className="mz-actions">
            <Link
              to={`/admin/institucional/estructura${entrada.pestana ? `?pestana=${entrada.pestana}` : ""}`}
              className="btn btn-outline-primary btn-sm"
            >
              <Icon name={entrada.icono} /> {entrada.texto}
            </Link>
          </div>
        )}
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {datos && (
        <div className="org-barra">
          <span className="mz-pill">
            {datos.unidades.length} unidades · {datos.cargos.length} cargos
          </span>
          <span className="mz-pill">
            {totales.plazas - totales.vacantes} de {totales.plazas} plazas
            cubiertas
          </span>
          <div
            className="org-vista"
            role="radiogroup"
            aria-label="Cómo ver el organigrama"
          >
            {[
              ["arbol", "diagram-3", "Árbol por niveles"],
              ["lista", "list-ul", "Lista"],
            ].map(([id, icono, texto]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={vista === id}
                className={vista === id ? "is-activo" : undefined}
                onClick={() => cambiarVista(id)}
              >
                <Icon name={icono} /> {texto}
              </button>
            ))}
          </div>
          <label className="org-barra__check">
            <input
              type="checkbox"
              checked={conPersonas}
              onChange={(e) => setConPersonas(e.target.checked)}
            />{" "}
            Mostrar personas
          </label>
          <input
            type="search"
            className="form-control form-control-sm org-barra__buscar"
            placeholder="Buscar un cargo o una persona"
            aria-label="Buscar un cargo o una persona"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
        </div>
      )}

      {buscar.trim() && datos && (
        <ul className="org-resultados" aria-label="Resultados">
          {encontrados.map((c) => (
            <li key={c.id}>
              <strong>{nombreDeCargo(c, datos.unidades, datos.cargos)}</strong>
              <span className="mz-small">
                {c.ocupantes.map((p) => p.nombre).join(", ") || "Vacante"}
              </span>
            </li>
          ))}
          {encontrados.length === 0 && (
            <li className="mz-faint">Ningún cargo o persona coincide.</li>
          )}
        </ul>
      )}

      {datos && arbol.length === 0 && (
        <div className="mz-card">
          <div className="mz-card-body mz-empty">
            <Icon name="diagram-3" />
            <p>
              {deSuArea && !alcance.unidad
                ? "Todavía no tiene un cargo asignado: el organigrama de su área aparece cuando lo elija en «Mi perfil»."
                : "Todavía no hay organigrama."}
            </p>
            {puedeEditar && (
              <Link
                to="/admin/institucional/estructura"
                className="btn btn-primary btn-sm"
              >
                Empezar por los niveles
              </Link>
            )}
          </div>
        </div>
      )}

      {arbol.length > 0 &&
        (() => {
          const unidades = (
            <NivelesDeCargo.Provider value={datos.niveles_cargo ?? []}>
              <ul className="org-arbol">
                {arbol.map((nodo) => (
                  <Unidad
                    key={nodo.id}
                    nodo={nodo}
                    cargos={datos.cargos}
                    conPersonas={conPersonas}
                    cerradas={cerradas}
                    alternar={alternar}
                    vista={vista}
                  />
                ))}
              </ul>
            </NivelesDeCargo.Provider>
          );
          // Árbol: horizontal, en el lienzo con zoom. Lista: vertical e
          // indentada por nivel, para leerla de arriba abajo sin desplazarse
          // de lado (antes «Lista» solo cambiaba los cargos de cada unidad y
          // el dibujo seguía siendo el árbol).
          return vista === "lista" ? (
            <div
              className="org-lista"
              role="region"
              aria-label="Organigrama en lista"
            >
              {unidades}
            </div>
          ) : (
            <Lienzo>{unidades}</Lienzo>
          );
        })()}
    </div>
  );
}
