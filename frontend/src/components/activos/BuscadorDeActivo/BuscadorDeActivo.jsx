import { useEffect, useId, useRef, useState } from "react";

import { activosService } from "../../../api/activosService";
import "./BuscadorDeActivo.css";

/** Cuánto se espera a que alguien termine de teclear antes de preguntar. */
const ESPERA_MS = 250;

/** Cuántas coincidencias se muestran. */
const MAXIMO = 8;

/**
 * Elegir un equipo escribiendo o disparando la pistola.
 *
 * Sustituye a un desplegable con todos los activos, que tenía dos problemas y
 * el segundo era serio. El primero: buscar en una lista de trescientas líneas
 * con el equipo en la mano es más lento que teclear tres letras. El segundo: la
 * lista se pedía con un tope de trescientos, así que en un inventario del
 * tamaño que el documento dimensiona —entre cinco y diez mil equipos— el
 * trescientos uno sencillamente no se podía elegir, sin ningún aviso.
 *
 * Aquí se pregunta al servidor por lo que se escribe, que es lo mismo que hace
 * el buscador del inventario, así que no hay tope ni lista que se quede vieja.
 *
 * **La pistola funciona sin hacer nada especial.** Un lector USB o Bluetooth se
 * comporta como un teclado: teclea el código carácter por carácter y cierra con
 * Enter. Al pulsar Enter se busca sin esperar al temporizador y, si el código
 * identifica a un solo equipo, queda elegido —que es lo que ocurre siempre con
 * un código de barras—. Con varias coincidencias, Enter confirma la que esté
 * resaltada, como en cualquier desplegable con teclado; ese Enter nunca envía
 * el formulario, que es lo que haría un campo de texto corriente.
 */
export function BuscadorDeActivo({
  valor,
  onChange,
  etiqueta = "Activo intervenido",
  ayuda,
  disabled = false,
  requerido = false,
}) {
  const idCampo = useId();
  const idLista = `${idCampo}-lista`;

  const [elegido, setElegido] = useState(null);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState([]);
  const [abierta, setAbierta] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState(null);

  const campoRef = useRef(null);
  // Qué búsqueda es la vigente: dos peticiones pueden cruzarse y la vieja no
  // debe pisar a la nueva (es el mismo cuidado que en los listados).
  const consulta = useRef(0);

  // Con un equipo preseleccionado —se llega aquí desde su ficha o desde el
  // escáner— hay que pedir su nombre para poder enseñarlo: por la URL solo
  // viaja el número.
  useEffect(() => {
    if (!valor) {
      setElegido(null);
      return;
    }
    if (elegido?.id === Number(valor)) {
      return;
    }
    activosService
      .get(valor)
      .then(setElegido)
      .catch(() => setError("No se pudo cargar el equipo seleccionado."));
  }, [valor, elegido]);

  async function buscar(termino) {
    const esta = ++consulta.current;
    setBuscando(true);
    setError(null);
    try {
      const datos = await activosService.list({
        q: termino,
        operativos: "true",
        page_size: MAXIMO,
      });
      if (esta !== consulta.current) return [];
      const encontrados = datos.results ?? datos;
      setResultados(encontrados);
      setResaltado(0);
      return encontrados;
    } catch {
      if (esta === consulta.current) {
        setError("No se pudo buscar. Inténtelo de nuevo.");
        setResultados([]);
      }
      return [];
    } finally {
      if (esta === consulta.current) setBuscando(false);
    }
  }

  // Se espera a que la persona deje de teclear; la pistola, que escribe de
  // golpe y cierra con Enter, no llega a notarlo.
  useEffect(() => {
    if (!abierta || texto.trim().length < 2) {
      return undefined;
    }
    const temporizador = setTimeout(() => buscar(texto.trim()), ESPERA_MS);
    return () => clearTimeout(temporizador);
  }, [texto, abierta]);

  function elegir(activo) {
    setElegido(activo);
    setAbierta(false);
    setTexto("");
    setResultados([]);
    onChange(String(activo.id), activo);
  }

  function limpiar() {
    setElegido(null);
    setTexto("");
    setResultados([]);
    onChange("", null);
    campoRef.current?.focus();
  }

  async function alPulsarEnter(evento) {
    // Sin esto, el Enter de la pistola enviaría el formulario entero con el
    // resto de los campos vacíos.
    evento.preventDefault();

    const termino = texto.trim();
    if (!termino) return;

    const encontrados =
      resultados.length > 0 ? resultados : await buscar(termino);
    if (encontrados.length === 1) {
      elegir(encontrados[0]);
      return;
    }
    if (encontrados.length > 1 && abierta) {
      elegir(encontrados[resaltado] ?? encontrados[0]);
    }
  }

  function alTeclear(evento) {
    if (evento.key === "Enter") {
      alPulsarEnter(evento);
      return;
    }
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setResaltado((actual) => Math.min(actual + 1, resultados.length - 1));
      return;
    }
    if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setResaltado((actual) => Math.max(actual - 1, 0));
      return;
    }
    if (evento.key === "Escape") {
      setAbierta(false);
    }
  }

  if (elegido) {
    return (
      <div className="buscador-activo">
        <span className="form-label d-block">{etiqueta}</span>
        <div className="buscador-activo__elegido">
          <div>
            <code className="codigo-barras">{elegido.codigo_barras}</code>{" "}
            {elegido.nombre}
            <small className="d-block text-muted">
              {elegido.marca} {elegido.modelo} · {elegido.numero_serie}
            </small>
          </div>
          {!disabled && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={limpiar}
            >
              Cambiar
            </button>
          )}
        </div>
        {ayuda && <div className="form-text">{ayuda}</div>}
      </div>
    );
  }

  const hayQueEscribirMas = abierta && texto.trim().length < 2;

  return (
    <div className="buscador-activo">
      <label className="form-label" htmlFor={idCampo}>
        {etiqueta}
      </label>
      <input
        id={idCampo}
        ref={campoRef}
        className="form-control"
        type="text"
        role="combobox"
        aria-expanded={abierta && resultados.length > 0}
        aria-controls={idLista}
        aria-autocomplete="list"
        autoComplete="off"
        // Una pistola no necesita corrección ortográfica ni mayúsculas
        // automáticas del móvil, que además corromperían el código.
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
        placeholder="Escanee la etiqueta o escriba código, serie o nombre"
        disabled={disabled}
        required={requerido}
        value={texto}
        onChange={(evento) => {
          setTexto(evento.target.value);
          setAbierta(true);
        }}
        onFocus={() => setAbierta(true)}
        onKeyDown={alTeclear}
      />

      {error && <div className="form-text text-danger">{error}</div>}
      {hayQueEscribirMas && (
        <div className="form-text">
          Escriba al menos dos caracteres, o dispare la pistola sobre la
          etiqueta.
        </div>
      )}
      {!error && !hayQueEscribirMas && ayuda && (
        <div className="form-text">{ayuda}</div>
      )}

      {abierta && (resultados.length > 0 || buscando) && (
        <ul className="buscador-activo__lista" id={idLista} role="listbox">
          {buscando && resultados.length === 0 && (
            <li className="buscador-activo__vacio">Buscando…</li>
          )}
          {resultados.map((activo, indice) => (
            <li key={activo.id}>
              <button
                type="button"
                role="option"
                aria-selected={indice === resaltado}
                className={`buscador-activo__opcion ${
                  indice === resaltado ? "buscador-activo__opcion--activa" : ""
                }`}
                onMouseEnter={() => setResaltado(indice)}
                onClick={() => elegir(activo)}
              >
                <code className="codigo-barras">{activo.codigo_barras}</code>{" "}
                {activo.nombre}
                <small className="d-block text-muted">
                  {activo.marca} {activo.modelo} · {activo.numero_serie}
                  {activo.custodio_nombre ? ` · ${activo.custodio_nombre}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}

      {abierta &&
        !buscando &&
        texto.trim().length >= 2 &&
        resultados.length === 0 &&
        !error && (
          <div className="form-text">
            {/* Se distingue de «no busqué todavía»: con el equipo en la mano,
                que no aparezca suele significar que está dado de baja o que la
                etiqueta es de otra empresa. */}
            Ningún equipo operativo coincide con «{texto.trim()}».
          </div>
        )}
    </div>
  );
}
