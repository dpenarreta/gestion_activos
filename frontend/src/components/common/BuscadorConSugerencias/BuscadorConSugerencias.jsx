import { useId, useState } from "react";

import { useBusquedaEnVivo } from "../../../hooks/useBusquedaEnVivo";
import { useUltimaPeticion } from "../../../hooks/useUltimaPeticion";
import { AnuncioDeResultados } from "../AnuncioDeResultados/AnuncioDeResultados";
import "./BuscadorConSugerencias.css";

/*
 * Un buscador con sugerencias en vivo (06/11/2026): el de la barra superior
 * y el del escáner.
 *
 * El pedido fue que todos los buscadores filtren mientras se escribe. Estos
 * no filtran una lista de la pantalla —el de la barra vive encima de
 * cualquier pantalla; el del escáner busca un código exacto—, y navegar o
 * consultar el código en cada tecla sacaría a la persona de donde está o la
 * llenaría de «no existe» a mitad de escribir. Así que muestran lo que van
 * encontrando debajo del campo, como un combobox (patrón «combobox con lista»
 * de las prácticas de ARIA):
 *
 * - Flechas ↑/↓ recorren las sugerencias, Enter abre la marcada, Escape
 *   cierra la lista (y un segundo Escape vacía el campo, lo del navegador).
 * - **Enter sin nada marcado hace lo de siempre** (`alConfirmar`): es el
 *   camino de la pistola lectora, que teclea el código de golpe y cierra con
 *   Enter antes de que la espera de las sugerencias llegue a cumplirse. Ese
 *   Enter cancela la sugerencia pendiente y descarta la que esté en camino.
 * - El foco no se va del campo: las sugerencias se marcan con
 *   `aria-activedescendant`, y mientras se confirma el campo queda de solo
 *   lectura en vez de deshabilitado (deshabilitarlo lo echaba del foco).
 */
export function BuscadorConSugerencias({
  etiqueta,
  placeholder,
  icono,
  // El dibujo: por defecto el de la barra superior. El escáner usa un
  // `input-group` de Bootstrap con su botón.
  className = "mz-search busqueda-global",
  claseGrupo,
  claseCampo,
  etiquetaRegion,
  sufijo,
  campoRef,
  buscar,
  claveDe,
  contenidoDe,
  alElegir,
  alConfirmar,
  textoVerTodos,
  alVerTodos,
  // Qué hacer si no hay sugerencias, dicho bajo el campo: «Pulse Enter
  // para buscarlo en el inventario».
  textoSinSugerencias = (termino) =>
    `Sin sugerencias para «${termino}». Pulse Enter para buscarlo.`,
  minimo = 2,
}) {
  const id = useId();
  const idCampo = `${id}-campo`;
  const idLista = `${id}-lista`;
  const [sugerencias, setSugerencias] = useState([]);
  // Cuántas coincidencias hay en total, no solo las que caben en la lista:
  // «6 sugerencias de 12» (auditoría UX/UI, 06/11/2026).
  const [totalReal, setTotalReal] = useState(0);
  // Con qué texto se pidieron las sugerencias que se están viendo.
  const [buscadoCon, setBuscadoCon] = useState("");
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [abierta, setAbierta] = useState(false);
  const [activa, setActiva] = useState(-1);
  const [enviando, setEnviando] = useState(false);
  // Una respuesta lenta no pisa a una más nueva, ni a un Enter.
  const nuevaPeticion = useUltimaPeticion();

  const busqueda = useBusquedaEnVivo({
    alBuscar: (termino) => {
      const vigente = nuevaPeticion();
      setActiva(-1);
      if (termino.length < minimo) {
        setSugerencias([]);
        setBuscadoCon("");
        setCargando(false);
        setFallo(false);
        return;
      }
      setCargando(true);
      Promise.resolve()
        .then(() => buscar(termino))
        // `buscar` devuelve la lista o `{ resultados, total }`.
        .then((respuesta) => {
          if (!vigente()) return;
          const lista = Array.isArray(respuesta)
            ? respuesta
            : (respuesta?.resultados ?? []);
          setSugerencias(lista);
          setTotalReal(
            Array.isArray(respuesta)
              ? lista.length
              : (respuesta?.total ?? lista.length),
          );
          setBuscadoCon(termino);
          setFallo(false);
        })
        .catch(() => {
          if (!vigente()) return;
          setSugerencias([]);
          setBuscadoCon(termino);
          setFallo(true);
        })
        .finally(() => vigente() && setCargando(false));
    },
  });

  const termino = busqueda.texto.trim();
  const opciones = [
    ...sugerencias.map((item) => ({ tipo: "item", item })),
    // «Ver todos» solo si hubo algo: sin sugerencias, el vacío ya dice que
    // Enter busca igual.
    ...(alVerTodos && sugerencias.length > 0 ? [{ tipo: "todos" }] : []),
  ];
  const visible = abierta && termino.length >= minimo && Boolean(buscadoCon);
  const expandida = visible && opciones.length > 0;
  const idOpcion = (indice) => `${id}-opcion-${indice}`;

  function reiniciar() {
    nuevaPeticion();
    busqueda.fijar("");
    setSugerencias([]);
    setBuscadoCon("");
    setCargando(false);
    setAbierta(false);
    setActiva(-1);
  }

  function elegir(opcion) {
    if (opcion.tipo === "todos") alVerTodos(buscadoCon);
    else alElegir(opcion.item);
    reiniciar();
  }

  async function confirmar(evento) {
    evento.preventDefault();
    if (expandida && activa >= 0 && opciones[activa]) {
      elegir(opciones[activa]);
      return;
    }
    const valor = busqueda.texto.trim();
    if (!valor) return;
    // Lo que la espera tenía preparado y lo que ya viaja, fuera: el Enter
    // manda.
    nuevaPeticion();
    busqueda.fijar(busqueda.texto);
    setAbierta(false);
    setEnviando(true);
    try {
      await alConfirmar(valor);
    } finally {
      setEnviando(false);
      reiniciar();
    }
  }

  function alTeclear(evento) {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      if (!opciones.length) return;
      evento.preventDefault();
      setAbierta(true);
      const paso = evento.key === "ArrowDown" ? 1 : -1;
      setActiva((actual) => {
        if (actual < 0) return paso > 0 ? 0 : opciones.length - 1;
        return (actual + paso + opciones.length) % opciones.length;
      });
      return;
    }
    if (evento.key === "Escape" && visible) {
      // El primer Escape cierra el panel —también el de «Sin sugerencias»—
      // sin borrar lo escrito (lo que haría el `type="search"`); el
      // siguiente, el del navegador, vacía el campo.
      evento.preventDefault();
      setAbierta(false);
      setActiva(-1);
    }
  }

  return (
    <form
      className={`buscador-sugerencias ${className}`}
      role="search"
      aria-label={etiquetaRegion}
      onSubmit={confirmar}
      onBlur={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget)) {
          setAbierta(false);
          setActiva(-1);
        }
      }}
    >
      <label className="visually-hidden" htmlFor={idCampo}>
        {etiqueta}
      </label>
      {/* Con `claseGrupo`, icono, campo y botón van juntos en un grupo. */}
      <Envoltorio clase={claseGrupo}>
        {claseGrupo ? (
          <span className="input-group-text">
            <i className={`bi bi-${icono}`} aria-hidden="true" />
          </span>
        ) : (
          <i className={`bi bi-${icono}`} aria-hidden="true" />
        )}
        <input
          ref={campoRef}
          className={claseCampo}
          id={idCampo}
          type="search"
          role="combobox"
          aria-expanded={expandida}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={
            expandida && activa >= 0 ? idOpcion(activa) : undefined
          }
          aria-busy={cargando || enviando || undefined}
          placeholder={placeholder}
          value={busqueda.texto}
          onChange={(evento) => {
            busqueda.cambiar(evento);
            setAbierta(true);
          }}
          onFocus={() => setAbierta(true)}
          onKeyDown={alTeclear}
          readOnly={enviando}
          autoComplete="off"
          // Una lectora no necesita corrección ni mayúsculas automáticas del
          // móvil, que además corromperían el código.
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        {sufijo?.({ texto: busqueda.texto, enviando })}
      </Envoltorio>
      <AnuncioDeResultados
        termino={visible ? buscadoCon : ""}
        total={sugerencias.length}
        de={totalReal}
        sustantivo={["sugerencia", "sugerencias"]}
        cargando={cargando}
        restoEnVerTodos={Boolean(alVerTodos)}
      />
      {/* La lista existe siempre (el `aria-controls` apunta a algo); se
          enseña cuando hay qué enseñar. */}
      <div
        className="buscador-sugerencias__panel"
        hidden={!visible}
        aria-busy={cargando || undefined}
      >
        <ul
          id={idLista}
          role="listbox"
          aria-label={`Sugerencias para ${buscadoCon}`}
          className="buscador-sugerencias__lista"
        >
          {opciones.map((opcion, indice) => (
            <li
              key={opcion.tipo === "todos" ? "__todos" : claveDe(opcion.item)}
              id={idOpcion(indice)}
              role="option"
              aria-selected={indice === activa}
              className={[
                "buscador-sugerencias__opcion",
                opcion.tipo === "todos" &&
                  "buscador-sugerencias__opcion--todos",
                indice === activa && "is-activa",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseMove={() => setActiva(indice)}
              // mousedown y no click: el campo no pierde el foco antes y la
              // lista no se cierra bajo el puntero.
              onMouseDown={(evento) => {
                evento.preventDefault();
                elegir(opcion);
              }}
            >
              {opcion.tipo === "todos"
                ? textoVerTodos(buscadoCon)
                : contenidoDe(opcion.item)}
            </li>
          ))}
        </ul>
        {!cargando && sugerencias.length === 0 && (
          <p className="buscador-sugerencias__vacio">
            {fallo
              ? "No se pudieron traer sugerencias. Enter busca igual."
              : textoSinSugerencias(buscadoCon)}
          </p>
        )}
      </div>
    </form>
  );
}

function Envoltorio({ clase, children }) {
  return clase ? <div className={clase}>{children}</div> : children;
}
