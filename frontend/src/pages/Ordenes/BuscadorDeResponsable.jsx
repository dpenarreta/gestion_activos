import { useEffect, useRef, useState } from "react";

import { Icon } from "../../components/common/Icon/Icon";
import { ESPERA_BUSQUEDA_MS } from "../../hooks/useBusquedaEnVivo";
import { useUltimaPeticion } from "../../hooks/useUltimaPeticion";

/** Lo escrito sin tildes ni mayúsculas, para comparar con una opción. */
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** El aviso por defecto de quien escribió un nombre y no lo eligió. */
export const SIN_ELEGIR =
  "Elija una opción de la lista o registre un proveedor nuevo.";

/*
 * Elegir quién realiza una orden escribiendo parte de su nombre (US-006,
 * 11/11/2026): un combobox con la lista en dos grupos, «Proveedores» y
 * «Personas», según el patrón «combobox con lista» de las prácticas de ARIA.
 *
 * - La lista se abre al teclear, al hacer clic o con ↓, **no al recibir el
 *   foco**: tras validar, el foco llega aquí para mostrar el error y una
 *   lista abierta lo tapaba (QA-UX, ronda 1, 11/11/2026).
 * - El foco no sale del campo: la opción marcada se anuncia con
 *   `aria-activedescendant` y se trae a la vista. ↑/↓ recorren, Inicio/Fin
 *   saltan al primero o al último mientras se recorre la lista, Enter elige
 *   la marcada (o la primera) y Escape cierra sin borrar lo escrito.
 * - La última fila siempre ofrece registrar un proveedor con lo escrito: es
 *   el camino cuando lo que se busca no existe.
 * - Escribir después de elegir deshace la elección: lo que se ve en el campo
 *   es lo que se va a guardar. Al salir con texto sin elegir, si coincide
 *   exactamente con una sola opción se elige; si no, se dice que falta
 *   elegir (`mensajeSinElegir`, el mismo que da el formulario al enviar).
 * - Enter sin opción marcada solo elige si lo escrito coincide exactamente
 *   con una única opción de los resultados de ese mismo texto: elegir «la
 *   primera» con resultados viejos o parciales elegía a otra persona (QA-UX,
 *   ronda 2, 11/11/2026).
 * - Se pregunta al servidor 300 ms después de la última tecla; una respuesta
 *   lenta no pisa a una más nueva.
 *
 * No usa `BuscadorConSugerencias` porque aquel es un `<form role="search">`
 * propio y este vive dentro del formulario de la orden, y porque necesita los
 * grupos y la elección persistente.
 */
export function BuscadorDeResponsable({
  id,
  etiqueta,
  obligatorio = false,
  ayuda,
  error,
  valor,
  onChange,
  onTexto,
  onRegistrar,
  buscar,
  soloProveedores = false,
  placeholder,
  textoVacio,
  etiquetaQuitar,
  mensajeSinElegir = SIN_ELEGIR,
  className = "",
}) {
  const idLista = `${id}-lista`;
  const campoRef = useRef(null);
  const buscarRef = useRef(buscar);
  useEffect(() => {
    buscarRef.current = buscar;
  });

  const [texto, setTexto] = useState(valor?.nombre ?? "");
  const [abierta, setAbierta] = useState(false);
  const [activa, setActiva] = useState(-1);
  const [datos, setDatos] = useState(null);
  const [buscadoCon, setBuscadoCon] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0);
  const [sinElegir, setSinElegir] = useState(false);
  const nuevaPeticion = useUltimaPeticion();
  // El último cambio de `valor` lo provocó quien escribe en el campo.
  const cambioPorTecleo = useRef(false);
  // Se eligió la fila de registrar: el foco se va a la ventana y esa salida
  // no es «se fue sin elegir».
  const yendoARegistrar = useRef(false);

  // Una elección que llega de fuera (el proveedor recién registrado, el
  // propuesto al elegir otra persona) se ve en el campo; si de fuera queda
  // vacío, el campo también.
  useEffect(() => {
    if (valor) {
      setTexto(valor.nombre);
      setSinElegir(false);
    } else if (!cambioPorTecleo.current) {
      setTexto("");
    }
    cambioPorTecleo.current = false;
  }, [valor]);

  useEffect(() => {
    onTexto?.(texto);
  }, [texto, onTexto]);

  // Con algo elegido, abrir la lista muestra los primeros de cada grupo y no
  // solo el elegido.
  const termino = valor ? "" : texto.trim();

  useEffect(() => {
    if (!abierta) return undefined;
    const vigente = nuevaPeticion();
    setCargando(true);
    const pausa = setTimeout(
      () => {
        Promise.resolve()
          .then(() => buscarRef.current(termino))
          .then((respuesta) => {
            if (!vigente()) return;
            setDatos(respuesta);
            setBuscadoCon(termino);
            setFallo(false);
          })
          .catch(() => {
            if (!vigente()) return;
            setBuscadoCon(termino);
            setFallo(true);
          })
          .finally(() => vigente() && setCargando(false));
      },
      termino ? ESPERA_BUSQUEDA_MS : 0,
    );
    return () => clearTimeout(pausa);
  }, [abierta, termino, intento, nuevaPeticion]);

  const hayResultado = buscadoCon !== null && !fallo;
  const proveedores = hayResultado ? (datos?.proveedores ?? []) : [];
  const personas =
    hayResultado && !soloProveedores ? (datos?.personas ?? []) : [];
  const elegibles = [
    ...proveedores.map((item) => ({ tipo: "proveedor", item })),
    ...personas.map((item) => ({ tipo: "persona", item })),
  ];
  // La fila de registrar va siempre al final y se recorre con las flechas.
  const opciones = onRegistrar
    ? [...elegibles, { tipo: "registrar" }]
    : elegibles;
  const expandida = abierta && opciones.length > 0;
  const idOpcion = (indice) => `${id}-opcion-${indice}`;
  const indiceRegistrar = onRegistrar ? opciones.length - 1 : -1;

  // La opción marcada con el teclado, siempre a la vista (QA-TECH, P2).
  useEffect(() => {
    if (activa < 0) return;
    document
      .getElementById(`${id}-opcion-${activa}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activa, id]);

  function cerrar() {
    setAbierta(false);
    setActiva(-1);
  }

  function elegir(opcion) {
    if (opcion.tipo === "registrar") {
      cerrar();
      yendoARegistrar.current = true;
      onRegistrar(valor ? "" : texto.trim());
      return;
    }
    const { tipo, item } = opcion;
    onChange({
      tipo,
      id: item.id,
      nombre: item.nombre,
      proveedor: item.proveedor ?? null,
    });
    setTexto(item.nombre);
    setSinElegir(false);
    cerrar();
  }

  function quitar() {
    cambioPorTecleo.current = true;
    onChange(null);
    setTexto("");
    setSinElegir(false);
    campoRef.current?.focus();
  }

  /** Las opciones cuyo nombre es exactamente lo escrito. */
  function iguales() {
    return elegibles.filter(
      ({ item }) => normalizar(item.nombre) === normalizar(texto),
    );
  }

  /** Al salir con texto y sin elección. */
  function alSalir() {
    cerrar();
    if (yendoARegistrar.current) {
      yendoARegistrar.current = false;
      return;
    }
    if (valor || !texto.trim()) return;
    // Basta con lo ya traído: quien sale antes de que llegue la búsqueda de
    // lo último que tecleó también consigue la elección si el nombre está.
    const coincidencias = iguales();
    if (coincidencias.length === 1) elegir(coincidencias[0]);
    else setSinElegir(true);
  }

  function alTeclear(evento) {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      if (!abierta) {
        setAbierta(true);
        return;
      }
      if (!opciones.length) return;
      const paso = evento.key === "ArrowDown" ? 1 : -1;
      setActiva((actual) => {
        if (actual < 0) return paso > 0 ? 0 : opciones.length - 1;
        return (actual + paso + opciones.length) % opciones.length;
      });
      return;
    }
    // Inicio/Fin saltan dentro de la lista solo mientras se la recorre; si
    // no, mueven el cursor del texto, como en cualquier campo.
    if ((evento.key === "Home" || evento.key === "End") && activa >= 0) {
      evento.preventDefault();
      setActiva(evento.key === "Home" ? 0 : opciones.length - 1);
      return;
    }
    if (evento.key === "Enter" && abierta) {
      // Con la lista abierta, Enter nunca envía la orden. Elige la marcada
      // o, sin marcada, la única que coincide exactamente con lo escrito en
      // resultados de ese mismo texto; si no, dice que falta elegir.
      evento.preventDefault();
      if (activa >= 0 && opciones[activa]) {
        elegir(opciones[activa]);
        return;
      }
      if (valor || !texto.trim()) return;
      const coincidencias =
        buscadoCon === termino && !cargando ? iguales() : [];
      if (coincidencias.length === 1) elegir(coincidencias[0]);
      else setSinElegir(true);
      return;
    }
    if (evento.key === "Escape" && abierta) {
      evento.preventDefault();
      cerrar();
    }
  }

  // Lo que se anuncia (y se ve en la lista cuando no hay opciones).
  let estado = "";
  if (abierta) {
    if (cargando && buscadoCon === null) estado = "Buscando…";
    else if (fallo) estado = "No se pudo buscar.";
    else if (hayResultado && elegibles.length === 0) {
      estado = textoVacio(buscadoCon);
    } else if (hayResultado) {
      estado = soloProveedores
        ? cuenta(proveedores.length, "proveedor", "proveedores")
        : `${cuenta(proveedores.length, "proveedor", "proveedores")} y ${cuenta(
            personas.length,
            "persona",
            "personas",
          )}`;
    }
  }

  const mensajeError = error || (sinElegir ? mensajeSinElegir : null);
  const idAyuda = ayuda ? `${id}-ayuda` : null;
  const idError = mensajeError ? `${id}-error` : null;
  const describe = [idAyuda, idError].filter(Boolean).join(" ") || undefined;
  const textoRegistrar =
    !valor && texto.trim()
      ? `Registrar proveedor «${texto.trim()}»`
      : "Registrar proveedor nuevo";

  return (
    <div
      className={`mz-campo ordenes-responsable ${className}`.trim()}
      onBlur={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget)) alSalir();
      }}
    >
      <label className="form-label" htmlFor={id}>
        {etiqueta}
        {obligatorio && (
          <>
            <span className="mz-campo__obligatorio" aria-hidden="true">
              {" "}
              *
            </span>
            <span className="visually-hidden"> (obligatorio)</span>
          </>
        )}
      </label>
      <div className="ordenes-responsable__control">
        <input
          ref={campoRef}
          id={id}
          type="text"
          role="combobox"
          className={["form-control", mensajeError && "is-invalid"]
            .filter(Boolean)
            .join(" ")}
          aria-required={obligatorio || undefined}
          aria-invalid={mensajeError ? true : undefined}
          aria-describedby={describe}
          aria-expanded={expandida}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={
            expandida && activa >= 0 ? idOpcion(activa) : undefined
          }
          aria-busy={(abierta && cargando) || undefined}
          placeholder={placeholder}
          value={texto}
          onChange={(evento) => {
            setTexto(evento.target.value);
            setActiva(-1);
            setAbierta(true);
            setSinElegir(false);
            if (valor) {
              cambioPorTecleo.current = true;
              onChange(null);
            }
          }}
          onClick={() => setAbierta(true)}
          onKeyDown={alTeclear}
          autoComplete="off"
          spellCheck="false"
        />
        {etiquetaQuitar && valor && (
          <button
            type="button"
            className="btn btn-outline-secondary ordenes-responsable__quitar"
            onClick={quitar}
            aria-label={etiquetaQuitar}
          >
            Quitar
          </button>
        )}
      </div>

      {/* La lista existe siempre: `aria-controls` apunta a algo. El
          `mousedown` del panel no se cumple para que arrastrar su barra de
          desplazamiento no saque el foco del campo y la cierre. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="ordenes-responsable__panel"
        hidden={!abierta}
        aria-busy={(abierta && cargando) || undefined}
        onMouseDown={(evento) => evento.preventDefault()}
      >
        <div
          id={idLista}
          role="listbox"
          aria-label={`Opciones para ${etiqueta}`}
        >
          {proveedores.length > 0 && (
            <Grupo id={`${id}-grupo-proveedores`} titulo="Proveedores">
              {proveedores.map((item, i) => (
                <Opcion
                  key={`p-${item.id}`}
                  id={idOpcion(i)}
                  activa={i === activa}
                  elegida={
                    (valor?.tipo ?? "proveedor") === "proveedor" &&
                    valor?.id === item.id
                  }
                  onMarcar={() => setActiva(i)}
                  onElegir={() => elegir({ tipo: "proveedor", item })}
                >
                  {item.nombre}
                </Opcion>
              ))}
            </Grupo>
          )}
          {personas.length > 0 && (
            <Grupo id={`${id}-grupo-personas`} titulo="Personas">
              {personas.map((item, j) => {
                const i = proveedores.length + j;
                return (
                  <Opcion
                    key={`u-${item.id}`}
                    id={idOpcion(i)}
                    activa={i === activa}
                    elegida={valor?.tipo === "persona" && valor.id === item.id}
                    onMarcar={() => setActiva(i)}
                    onElegir={() => elegir({ tipo: "persona", item })}
                  >
                    {item.nombre}
                    <small>
                      {item.proveedor
                        ? `Último proveedor: ${item.proveedor.nombre}`
                        : "Sin proveedor anterior"}
                    </small>
                  </Opcion>
                );
              })}
            </Grupo>
          )}
          {onRegistrar && (
            <Opcion
              id={idOpcion(indiceRegistrar)}
              activa={activa === indiceRegistrar}
              className="ordenes-responsable__opcion--registrar"
              onMarcar={() => setActiva(indiceRegistrar)}
              onElegir={() => elegir({ tipo: "registrar" })}
            >
              <Icon name="plus-lg" /> {textoRegistrar}
            </Opcion>
          )}
        </div>
        {estado && elegibles.length === 0 && (
          <div className="ordenes-responsable__vacio">
            <span>{estado}</span>
            {fallo && (
              <button
                type="button"
                className="btn btn-link p-0 ms-2 ordenes-responsable__reintentar"
                onClick={() => setIntento((n) => n + 1)}
              >
                Reintentar
              </button>
            )}
          </div>
        )}
      </div>
      {/* Lo que encuentra se anuncia sin mover el foco del campo. */}
      <div className="visually-hidden" role="status">
        {estado}
      </div>

      {ayuda && (
        <div id={idAyuda} className="form-text">
          {ayuda}
        </div>
      )}
      {mensajeError && (
        <div id={idError} className="mz-field-error">
          {mensajeError}
        </div>
      )}
    </div>
  );
}

function Grupo({ id, titulo, children }) {
  return (
    <div role="group" aria-labelledby={id}>
      <div id={id} role="presentation" className="ordenes-responsable__grupo">
        {titulo}
      </div>
      {children}
    </div>
  );
}

function Opcion({
  id,
  activa,
  elegida = false,
  className = "",
  onMarcar,
  onElegir,
  children,
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={activa}
      // Enfocable solo por programa: el foco real se queda en el campo y la
      // opción marcada se anuncia con `aria-activedescendant`.
      tabIndex={-1}
      className={[
        "ordenes-responsable__opcion",
        activa && "is-activa",
        elegida && "is-elegida",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseMove={onMarcar}
      // mousedown y no click: el campo no pierde el foco antes y la lista no
      // se cierra bajo el puntero.
      onMouseDown={(evento) => {
        evento.preventDefault();
        onElegir();
      }}
    >
      {elegida && (
        <>
          <Icon name="check-lg" className="ordenes-responsable__check" />
          <span className="visually-hidden">Elegido: </span>
        </>
      )}
      {children}
    </div>
  );
}

function cuenta(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}
