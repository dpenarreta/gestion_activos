import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import "./BuscadorDeListas.css";

/*
 * Todo desplegable con buscador (28/10/2026): al abrir cualquier `<select>`
 * de la aplicación —con un clic, Espacio, Enter, F4 o Alt+↓— en vez de la
 * lista del navegador aparece una con un buscador arriba que filtra mientras
 * se escribe (sin distinguir tildes ni mayúsculas, cada palabra en cualquier
 * orden).
 *
 * Se monta una sola vez (App) y trabaja sobre los `<select>` que ya existen:
 * el `<select>` sigue en su lugar con su etiqueta, su validación y su
 * `onChange`; al elegir, se le pone el valor y se dispara el `change` de
 * siempre. Quedan nativos: los `multiple`, los marcados `data-sin-buscador`
 * y, en pantallas táctiles, las listas cortas (allí el selector del sistema
 * es mejor que un buscador sobre pocas opciones).
 */

const ELEGIBLE = "select:not([multiple]):not([size]):not([data-sin-buscador])";
const TECLAS_QUE_ABREN = new Set([" ", "Enter", "F4"]);
const CORTA_EN_TACTIL = 15;

const normalizar = (texto) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const esTactil = () =>
  window.matchMedia?.("(pointer: coarse)").matches ?? false;

function elegible(select) {
  if (!select || select.disabled) return false;
  return !(esTactil() && select.options.length <= CORTA_EN_TACTIL);
}

function leerOpciones(select) {
  return Array.from(select.options).map((opcion, indice) => ({
    indice,
    valor: opcion.value,
    texto: opcion.text,
    deshabilitada: opcion.disabled,
    grupo:
      opcion.parentElement?.tagName === "OPTGROUP"
        ? opcion.parentElement.label
        : null,
  }));
}

/** El nombre del campo, para el buscador: «Buscar en Cargo». */
function nombreDe(select) {
  const porId = (select.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
  if (porId) return porId;
  if (select.getAttribute("aria-label"))
    return select.getAttribute("aria-label");
  const etiqueta = select.labels?.[0];
  if (etiqueta) {
    // Sin el texto del propio select si está dentro de su etiqueta.
    const copia = etiqueta.cloneNode(true);
    copia.querySelectorAll("select").forEach((s) => s.remove());
    const texto = copia.textContent.replace(/\*/g, "").trim();
    if (texto) return texto;
  }
  return "Opciones";
}

function elegir(select, valor) {
  // El setter nativo y un `change` que burbujea: React lo ve como si la
  // persona hubiera elegido en la lista del navegador.
  const fijar = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  ).set;
  fijar.call(select, valor);
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function posicion(select) {
  const caja = select.getBoundingClientRect();
  // Con el teclado del teléfono abierto, el alto útil es el de la vista.
  const altoVista = window.visualViewport?.height ?? window.innerHeight;
  const ancho = Math.min(Math.max(caja.width, 240), window.innerWidth - 16);
  const izquierda = Math.min(caja.left, window.innerWidth - ancho - 8);
  const abajo = altoVista - caja.bottom;
  const arriba = caja.top;
  // Se abre hacia donde haya más lugar.
  const haciaArriba = abajo < 260 && arriba > abajo;
  const alto = Math.min(360, (haciaArriba ? arriba : abajo) - 12);
  return {
    left: Math.max(8, izquierda),
    width: ancho,
    maxHeight: Math.max(alto, 160),
    ...(haciaArriba
      ? { bottom: window.innerHeight - caja.top + 4 }
      : { top: caja.bottom + 4 }),
  };
}

let aperturas = 0;

export function BuscadorDeListas() {
  const [abierto, setAbierto] = useState(null);
  const abiertoRef = useRef(null);
  abiertoRef.current = abierto;

  const abrir = useCallback((select) => {
    aperturas += 1;
    setAbierto({ select, opciones: leerOpciones(select), clave: aperturas });
  }, []);

  const cerrar = useCallback((devolverFoco = true) => {
    const actual = abiertoRef.current;
    setAbierto(null);
    if (devolverFoco && actual && document.contains(actual.select)) {
      actual.select.focus();
    }
  }, []);

  useEffect(() => {
    function alPresionar(event) {
      const select = event.target.closest?.(ELEGIBLE);
      if (event.button !== 0 || !elegible(select)) return;
      // Sin esto se abriría también la lista del navegador.
      event.preventDefault();
      // Un segundo clic en el mismo campo la cierra, como la nativa.
      if (abiertoRef.current?.select === select) {
        cerrar();
        return;
      }
      select.focus();
      abrir(select);
    }
    function alTeclear(event) {
      const select = event.target.matches?.(ELEGIBLE) ? event.target : null;
      if (!elegible(select)) return;
      const abre =
        TECLAS_QUE_ABREN.has(event.key) ||
        (event.altKey &&
          (event.key === "ArrowDown" || event.key === "ArrowUp"));
      if (!abre) return;
      event.preventDefault();
      // Que Enter o Espacio no lleguen a un formulario o a otra ventana.
      event.stopPropagation();
      abrir(select);
    }
    document.addEventListener("mousedown", alPresionar, true);
    document.addEventListener("keydown", alTeclear, true);
    return () => {
      document.removeEventListener("mousedown", alPresionar, true);
      document.removeEventListener("keydown", alTeclear, true);
    };
  }, [abrir, cerrar]);

  // El select dice que su lista está abierta.
  useEffect(() => {
    const select = abierto?.select;
    if (!select) return undefined;
    select.setAttribute("aria-expanded", "true");
    return () => select.removeAttribute("aria-expanded");
  }, [abierto]);

  if (!abierto) return null;
  // La lista va dentro de la ventana del select: fuera de un `aria-modal`
  // los lectores de pantalla no la leen, y la trampa de foco de Bootstrap
  // devolvería el foco a la ventana.
  const contenedor =
    abierto.select.closest('[aria-modal="true"], [role="dialog"], .modal') ??
    document.body;
  return createPortal(
    <Lista
      key={abierto.clave}
      select={abierto.select}
      opciones={abierto.opciones}
      onCerrar={cerrar}
    />,
    contenedor,
  );
}

function Lista({ select, opciones, onCerrar }) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [estilo, setEstilo] = useState(() => posicion(select));
  const [activa, setActiva] = useState(() =>
    Math.max(
      0,
      opciones.findIndex((o) => o.indice === select.selectedIndex),
    ),
  );
  const [anuncio, setAnuncio] = useState("");
  const panel = useRef(null);
  const lista = useRef(null);

  const visibles = useMemo(() => {
    // Cada palabra, en cualquier orden: «talento jefe» encuentra «Jefe
    // Nacional de Talento Humano».
    const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
    if (!palabras.length) return opciones;
    return opciones.filter((o) => {
      const nombre = normalizar(o.texto);
      return palabras.every((p) => nombre.includes(p));
    });
  }, [opciones, texto]);

  // Al filtrar, la primera que se puede elegir queda marcada.
  useEffect(() => {
    if (!texto) return;
    setActiva(
      Math.max(
        0,
        visibles.findIndex((o) => !o.deshabilitada),
      ),
    );
  }, [texto, visibles]);

  // Cuántos resultados hay, para los lectores de pantalla (sin anunciar
  // cada letra).
  useEffect(() => {
    if (!texto) {
      setAnuncio("");
      return undefined;
    }
    const espera = setTimeout(
      () =>
        setAnuncio(
          visibles.length
            ? `${visibles.length} ${visibles.length === 1 ? "resultado" : "resultados"}`
            : `Sin resultados para ${texto}`,
        ),
      400,
    );
    return () => clearTimeout(espera);
  }, [texto, visibles.length]);

  useEffect(() => {
    lista.current
      ?.querySelector(`[data-pos="${activa}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activa]);

  useEffect(() => {
    function fuera(event) {
      if (panel.current?.contains(event.target)) return;
      // Un clic en otro desplegable ya abre su propia lista.
      if (event.target.closest?.(ELEGIBLE)) return;
      onCerrar(false);
    }
    // Si la página se mueve, la lista se reacomoda junto a su campo; solo se
    // cierra si el campo sale de la vista.
    let cuadro = 0;
    function reacomodar(event) {
      if (event?.target && panel.current?.contains(event.target)) return;
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => {
        const caja = select.getBoundingClientRect();
        if (caja.bottom < 0 || caja.top > window.innerHeight) onCerrar(false);
        else setEstilo(posicion(select));
      });
    }
    document.addEventListener("mousedown", fuera, true);
    window.addEventListener("scroll", reacomodar, true);
    window.addEventListener("resize", reacomodar);
    window.visualViewport?.addEventListener("resize", reacomodar);
    return () => {
      cancelAnimationFrame(cuadro);
      document.removeEventListener("mousedown", fuera, true);
      window.removeEventListener("scroll", reacomodar, true);
      window.removeEventListener("resize", reacomodar);
      window.visualViewport?.removeEventListener("resize", reacomodar);
    };
  }, [onCerrar, select]);

  function confirmar(opcion) {
    if (!opcion || opcion.deshabilitada) return;
    if (opcion.valor !== select.value) elegir(select, opcion.valor);
    onCerrar();
  }

  function mover(desde, paso) {
    let i = desde;
    for (let n = 0; n < visibles.length; n += 1) {
      i += paso;
      if (i < 0 || i >= visibles.length) return desde;
      if (!visibles[i].deshabilitada) return i;
    }
    return desde;
  }

  function alTeclear(event) {
    if (event.key === "Tab") {
      // Tab sigue su camino desde el campo: la lista se cierra y la trampa
      // de foco de la ventana hace lo suyo.
      onCerrar();
      return;
    }
    const acciones = {
      ArrowDown: () => setActiva((i) => mover(i, 1)),
      ArrowUp: () => setActiva((i) => mover(i, -1)),
      PageDown: () =>
        setActiva((i) => mover(Math.min(i + 7, visibles.length), -1)),
      PageUp: () => setActiva((i) => mover(Math.max(i - 7, -1), 1)),
      Enter: () => confirmar(visibles[activa]),
      Escape: () => onCerrar(),
    };
    const accion = acciones[event.key];
    if (!accion) return;
    event.preventDefault();
    // Escape cierra la lista, no la ventana que la contiene.
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
    accion();
  }

  const nombre = nombreDe(select);
  let grupoAnterior = null;

  return (
    <div className="buscador-listas" style={estilo} ref={panel}>
      <input
        type="search"
        className="form-control form-control-sm buscador-listas__buscar"
        placeholder="Buscar…"
        aria-label={`Buscar en ${nombre}`}
        aria-describedby={`${id}-ayuda`}
        role="combobox"
        aria-expanded="true"
        aria-controls={`${id}-lista`}
        aria-activedescendant={visibles[activa] ? `${id}-${activa}` : undefined}
        aria-autocomplete="list"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={alTeclear}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <span id={`${id}-ayuda`} className="visually-hidden">
        Flechas para moverse, Enter para elegir, Escape para cerrar.
      </span>
      <span className="visually-hidden" role="status" aria-live="polite">
        {anuncio}
      </span>
      {visibles.length === 0 && (
        <p className="buscador-listas__vacio" aria-hidden="true">
          Sin resultados para «{texto}»
        </p>
      )}
      <ul
        id={`${id}-lista`}
        role="listbox"
        aria-label={nombre}
        className="buscador-listas__lista"
        ref={lista}
      >
        {visibles.map((opcion, pos) => {
          const encabezado =
            opcion.grupo && opcion.grupo !== grupoAnterior ? (
              <li className="buscador-listas__grupo" role="presentation">
                {opcion.grupo}
              </li>
            ) : null;
          grupoAnterior = opcion.grupo;
          const elegida = opcion.indice === select.selectedIndex;
          return (
            <FilaConGrupo key={opcion.indice} encabezado={encabezado}>
              <li
                id={`${id}-${pos}`}
                data-pos={pos}
                role="option"
                aria-selected={elegida}
                aria-disabled={opcion.deshabilitada || undefined}
                aria-label={
                  opcion.grupo ? `${opcion.texto}, ${opcion.grupo}` : undefined
                }
                className={[
                  "buscador-listas__opcion",
                  pos === activa && "is-activa",
                  elegida && "is-elegida",
                  opcion.deshabilitada && "is-deshabilitada",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseMove={() => !opcion.deshabilitada && setActiva(pos)}
                // mousedown y no click: el buscador no pierde el foco antes.
                onMouseDown={(e) => {
                  e.preventDefault();
                  confirmar(opcion);
                }}
              >
                {opcion.texto || " "}
              </li>
            </FilaConGrupo>
          );
        })}
      </ul>
    </div>
  );
}

function FilaConGrupo({ encabezado, children }) {
  return (
    <>
      {encabezado}
      {children}
    </>
  );
}
