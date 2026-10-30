import { useCallback, useEffect, useId, useRef, useState } from "react";

import { capacitacionService } from "../../api/capacitacionService";
import { confirmar } from "../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { VisorPdf } from "../../components/common/VisorPdf/VisorPdf";
import {
  VisorPresentacion,
  esPresentacion,
} from "../../components/common/VisorPresentacion/VisorPresentacion";
import { useModalA11y } from "../../hooks/useModalA11y";
import { descargarBlob } from "../../utils/descargas";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import "./Institucional.css";

const GRUPOS = [
  ["empresa", "De la empresa", "building"],
  ["unidad", "De su área", "diagram-3"],
  ["cargo", "De su cargo", "briefcase"],
];

const numero = (n) => Number(n).toLocaleString("es-EC");
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Una ventana del módulo. `guardado` dice que lo de adentro ya se guardó
 * (el resultado de una evaluación): cerrar no pregunta si descartar.
 * `alCerrar` decide cómo se cierra (Escape, la X y «Cancelar»). */
function Ventana({
  titulo,
  onCerrar,
  children,
  ancha = false,
  guardado = false,
  confirmarAlDescartar = true,
  guardClose,
}) {
  const tituloId = useId();
  const { panelRef, handleBackdropClick, requestClose, marcarGuardado } =
    useModalA11y({
      isOpen: true,
      onRequestClose: onCerrar,
      confirmarAlDescartar,
      guardClose,
    });
  // Tras enviar la evaluación, cerrar ya no pregunta «¿Descartar los
  // cambios?»: el intento quedó guardado (auditoría UX/UI, 30/10/2026).
  useEffect(() => {
    if (guardado) marcarGuardado();
  }, [guardado, marcarGuardado]);
  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={`mz-modal${ancha ? " mz-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id={tituloId}>{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={requestClose}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">{children}</div>
      </div>
    </div>
  );
}

const ENLACE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?»"'])/g;
const VINETA = /^\s*[•\-*·]\s+/;

/** Las direcciones web de una línea, como enlaces (en otra pestaña). */
function conEnlaces(linea) {
  return linea.split(ENLACE).map((parte, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={parte}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${parte} (se abre en otra pestaña)`}
      >
        {parte}{" "}
        <Icon name="box-arrow-up-right" className="onboarding-texto__externo" />
      </a>
    ) : (
      parte
    ),
  );
}

/**
 * El texto de un material con un formato simple, sin cambiar cómo se escribe
 * (auditoría UX/UI, 30/10/2026): las líneas que empiezan con «•», «-» o «*»
 * son una lista; una línea corta que termina en «:» es un subtítulo; una
 * línea en blanco separa párrafos; las direcciones web son enlaces.
 */
export function TextoDelMaterial({ texto }) {
  const bloques = [];
  let lista = null;
  let parrafo = null;
  const cerrar = () => {
    lista = null;
    parrafo = null;
  };
  for (const cruda of String(texto ?? "").split(/\r?\n/)) {
    const linea = cruda.trimEnd();
    if (!linea.trim()) {
      cerrar();
      continue;
    }
    if (VINETA.test(linea)) {
      parrafo = null;
      if (!lista) {
        lista = { tipo: "lista", items: [] };
        bloques.push(lista);
      }
      lista.items.push(linea.replace(VINETA, ""));
      continue;
    }
    lista = null;
    if (linea.trim().endsWith(":") && linea.trim().length <= 80) {
      parrafo = null;
      bloques.push({ tipo: "subtitulo", texto: linea.trim() });
      continue;
    }
    if (!parrafo) {
      parrafo = { tipo: "parrafo", lineas: [] };
      bloques.push(parrafo);
    }
    parrafo.lineas.push(linea);
  }
  return bloques.map((b, i) => {
    if (b.tipo === "lista")
      return (
        <ul key={i}>
          {b.items.map((item, j) => (
            <li key={j}>{conEnlaces(item)}</li>
          ))}
        </ul>
      );
    if (b.tipo === "subtitulo")
      return (
        <h4 key={i} className="onboarding-texto__subtitulo">
          {b.texto}
        </h4>
      );
    return (
      <p key={i}>
        {b.lineas.map((l, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {conEnlaces(l)}
          </span>
        ))}
      </p>
    );
  });
}

/** «Lectura de unos 3 minutos» (a unas 200 palabras por minuto). */
export function tiempoDeLectura(texto) {
  const palabras = String(texto ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const minutos = Math.max(1, Math.round(palabras / 200));
  return minutos === 1
    ? "Lectura de 1 minuto"
    : `Lectura de unos ${minutos} minutos`;
}

/** Un material, con todo lo que trae: el texto, su archivo (el PDF y la
 * presentación se abren en el visor del sistema, sin salir) y el video.
 * Cuenta como visto al abrir el archivo o el video (o al abrir la ventana si
 * es solo texto): antes contaba con abrir la ventana, sin ver nada. */
function RevisarMaterial({
  material,
  onVisto,
  onAbrirArchivo,
  onEvaluar,
  onCerrar,
}) {
  const [error, setError] = useState(null);
  const [abriendo, setAbriendo] = useState(false);
  const soloTexto = !material.tiene_archivo && !material.url;
  const nombre = material.archivo_nombre || "";
  const presentacion = !material.archivo_es_pdf && esPresentacion(nombre);
  const pptAntiguo =
    material.tiene_archivo && !material.archivo_es_pdf && !presentacion;
  const puedeEvaluarse =
    (material.visto || soloTexto) &&
    material.preguntas > 0 &&
    !material.aprobado &&
    !material.agotado &&
    Boolean(onEvaluar);

  useEffect(() => {
    if (soloTexto) onVisto(material);
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function archivo() {
    if (abriendo) return;
    setError(null);
    setAbriendo(true);
    try {
      const blob = await capacitacionService.archivo(material.id);
      onVisto(material);
      if (pptAntiguo) {
        // El .ppt antiguo no se puede dibujar en el navegador: se descarga.
        descargarBlob(blob, nombre || `${material.titulo}.ppt`);
      } else {
        onAbrirArchivo(blob, material.archivo_es_pdf ? "pdf" : "pptx");
      }
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo abrir el archivo."));
    } finally {
      setAbriendo(false);
    }
  }

  const textoArchivo = material.archivo_es_pdf
    ? "Ver el PDF"
    : pptAntiguo
      ? "Descargar la presentación (.ppt)"
      : "Ver la presentación";

  return (
    <Ventana titulo={material.titulo} onCerrar={onCerrar} ancha>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {material.descripcion && (
        <p className="mz-faint">{material.descripcion}</p>
      )}
      {material.contenido && (
        <>
          <p className="onboarding-texto__lectura">
            <Icon name="clock" /> {tiempoDeLectura(material.contenido)}
          </p>
          {/* El foco empieza en el texto, para leer (antes en la X). */}
          <div
            className="onboarding-texto"
            // Una región que se desplaza tiene que poder enfocarse con Tab
            // para moverla con el teclado (WCAG 2.1.1).
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            aria-label={`Contenido de «${material.titulo}»`}
            role="region"
            data-autofocus={soloTexto ? true : undefined}
          >
            <TextoDelMaterial texto={material.contenido} />
          </div>
        </>
      )}
      {!soloTexto && (
        <>
          {!material.visto && (
            <p className="onboarding-indicacion">
              <Icon name="info-circle" /> Abra el material para habilitar su
              evaluación.
            </p>
          )}
          <div className="onboarding-archivos">
            {material.tiene_archivo && (
              <button
                type="button"
                className="onboarding-archivo"
                onClick={archivo}
                // Ocupado y no deshabilitado: así el visor devuelve el foco
                // a este botón al cerrarse.
                aria-busy={abriendo}
                data-autofocus
              >
                <Icon
                  name={
                    material.archivo_es_pdf
                      ? "file-earmark-pdf"
                      : "file-earmark-slides"
                  }
                  className="onboarding-archivo__icono"
                />
                <span>
                  <strong>{abriendo ? "Abriendo…" : textoArchivo}</strong>
                  {nombre && <small>{nombre}</small>}
                  {!pptAntiguo && (
                    <small>Se abre aquí, sin salir del sistema.</small>
                  )}
                </span>
              </button>
            )}
            {material.url && (
              <a
                className="onboarding-archivo"
                href={material.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onVisto(material)}
              >
                <Icon name="play-btn" className="onboarding-archivo__icono" />
                <span>
                  <strong>Ver el video</strong>
                  <small>Se abre en otra pestaña.</small>
                </span>
              </a>
            )}
          </div>
        </>
      )}
      <div className="mz-actions justify-content-end mt-3">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={onCerrar}
        >
          Cerrar
        </button>
        {/* Después de revisarlo, el siguiente paso a un clic. */}
        {puedeEvaluarse && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onEvaluar(material)}
          >
            <Icon name="pencil-square" /> Evaluarme ahora
          </button>
        )}
      </div>
    </Ventana>
  );
}

const NOMBRE_TIPO = {
  unica: "Marque la correcta",
  multiple: "Marque todas las correctas",
  completar: "Complete los espacios",
  unir: "Una cada concepto con su respuesta",
};

/** Si la pregunta ya tiene respuesta completa, según su tipo. */
export function respondida(p, respuesta) {
  if (p.tipo === "multiple")
    return Array.isArray(respuesta) && respuesta.length > 0;
  if (p.tipo === "completar")
    return (
      Array.isArray(respuesta) &&
      respuesta.filter((x) => (x ?? "").trim()).length === p.huecos
    );
  if (p.tipo === "unir")
    return (
      Boolean(respuesta) && p.izquierda.every((c) => Boolean(respuesta[c.id]))
    );
  return respuesta !== undefined;
}

/** Una pregunta según su tipo (22/10/2026). La respuesta que arma es la que
 * espera el servidor: una opción, una lista de opciones, una lista de
 * palabras o `{concepto_id: respuesta}`. */
function Pregunta({ p, i, respuesta, onResponder, falta }) {
  const id = `pregunta-${p.id}`;
  let cuerpo;
  if (p.tipo === "multiple") {
    const marcadas = respuesta ?? [];
    cuerpo = p.opciones.map((o) => (
      <label key={o.id} className="form-check">
        <input
          type="checkbox"
          className="form-check-input"
          checked={marcadas.includes(o.id)}
          onChange={(e) =>
            onResponder(
              e.target.checked
                ? [...marcadas, o.id]
                : marcadas.filter((x) => x !== o.id),
            )
          }
        />{" "}
        <span className="form-check-label">{o.texto}</span>
      </label>
    ));
  } else if (p.tipo === "completar") {
    const palabras = respuesta ?? Array(p.huecos).fill("");
    let hueco = -1;
    cuerpo = (
      <p className="mb-0 onboarding-frase">
        {p.segmentos.map((s, k) => {
          if (s !== null) return <span key={k}>{s}</span>;
          hueco += 1;
          const n = hueco;
          const valor = palabras[n] ?? "";
          // El texto que va antes del espacio, para que el lector de
          // pantalla sepa dónde está.
          const antes = String(p.segmentos[k - 1] ?? "")
            .trim()
            .split(/\s+/)
            .slice(-3)
            .join(" ");
          return (
            <input
              key={k}
              className="form-control form-control-sm onboarding-hueco"
              aria-label={`Espacio ${n + 1}${antes ? `, después de «${antes}»` : ""}`}
              maxLength={200}
              style={{ width: `${Math.max(8, valor.length + 2)}ch` }}
              value={valor}
              onChange={(e) =>
                onResponder(
                  palabras.map((x, m) => (m === n ? e.target.value : x)),
                )
              }
            />
          );
        })}
      </p>
    );
  } else if (p.tipo === "unir") {
    const elegidas = respuesta ?? {};
    const usadas = Object.values(elegidas).filter(Boolean);
    cuerpo = (
      <div className="onboarding-unir">
        {p.izquierda.map((c) => (
          <label key={c.id} className="contents">
            <span>{c.texto}</span>
            <select
              className="form-select form-select-sm"
              aria-label={`Respuesta para «${c.texto}»`}
              value={elegidas[c.id] ?? ""}
              onChange={(e) =>
                onResponder({ ...elegidas, [c.id]: e.target.value })
              }
            >
              <option value="">Elija…</option>
              {p.derecha.map((d) => (
                <option key={d} value={d}>
                  {/* Las ya elegidas para otro concepto, marcadas. */}
                  {d}
                  {usadas.includes(d) && elegidas[c.id] !== d
                    ? " — ya elegida"
                    : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  } else {
    cuerpo = p.opciones.map((o) => (
      <label key={o.id} className="form-check">
        <input
          type="radio"
          className="form-check-input"
          name={`pregunta-${p.id}`}
          checked={respuesta === o.id}
          onChange={() => onResponder(o.id)}
        />{" "}
        <span className="form-check-label">{o.texto}</span>
      </label>
    ));
  }
  return (
    <fieldset
      id={id}
      className={`onboarding-pregunta${falta ? " onboarding-pregunta--falta" : ""}`}
      aria-describedby={falta ? `${id}-falta` : undefined}
    >
      <legend>
        <span className="onboarding-pregunta__numero">{i + 1}.</span> {p.texto}
      </legend>
      <small className="onboarding-pregunta__tipo">
        {NOMBRE_TIPO[p.tipo] ?? ""} · {numero(p.puntos)} puntos
      </small>
      {cuerpo}
      {falta && (
        <small id={`${id}-falta`} className="onboarding-falta d-block">
          Falta responder esta pregunta.
        </small>
      )}
    </fieldset>
  );
}

/** `mm:ss` (o `h:mm:ss`) de unos segundos. */
export function formatoReloj(segundos) {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const dos = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${dos(m)}:${dos(s % 60)}` : `${dos(m)}:${dos(s % 60)}`;
}

/** Cada cuánto se guarda el borrador después del último cambio. */
const ESPERA_BORRADOR = 800;

/** El resultado de un intento: la nota grande, si aprobó, lo obtenido en cada
 * pregunta y el siguiente paso (auditoría UX/UI, 30/10/2026). Nunca dice cuál
 * era la respuesta correcta. */
function Resultado({ resultado, onReintentar, onRepasar, onCerrar }) {
  const titulo = useRef(null);
  // Tras el cuadro «¿Enviar?», que al cerrarse devuelve su foco: un cuadro
  // después, el foco va al resultado (el formulario ya no existe).
  useEffect(() => {
    const cuadro = requestAnimationFrame(() => titulo.current?.focus());
    return () => cancelAnimationFrame(cuadro);
  }, []);
  const quedan = resultado.intentos_restantes;
  const detalle = resultado.detalle ?? [];
  return (
    <div className="mz-stack">
      {resultado.por_tiempo && (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="stopwatch" />
          Se acabó el tiempo. Guardamos automáticamente todo lo que había
          respondido y con eso se calificó.
        </div>
      )}
      <section
        className={`onboarding-resultado${resultado.aprobado ? " onboarding-resultado--aprobado" : ""}`}
        role="status"
      >
        <h4 ref={titulo} tabIndex={-1} className="onboarding-resultado__titulo">
          Resultado
        </h4>
        <p className="onboarding-resultado__nota">
          <span className="onboarding-resultado__cifra">
            {numero(resultado.nota)}
          </span>{" "}
          / 10
        </p>
        <span
          className={`onboarding-estado ${resultado.aprobado ? "onboarding-estado--aprobado" : "onboarding-estado--por-aprobar"}`}
        >
          {resultado.aprobado ? "Aprobado" : "No aprobado"} ·{" "}
          {resultado.puntaje} %
        </span>
        <p className="mb-0 mt-2">
          {resultado.aprobado
            ? "¡Muy bien! Aprobó este material."
            : quedan > 0
              ? `Necesita el ${resultado.nota_minima} % para aprobar. Le ${quedan === 1 ? "queda" : "quedan"} ${plural(quedan, "intento", "intentos")}.`
              : `Necesita el ${resultado.nota_minima} % para aprobar y ya no le quedan intentos: pida a Talento Humano que se los devuelva.`}
        </p>
      </section>

      {detalle.length > 0 && (
        <section aria-labelledby="resultado-detalle">
          <h5 id="resultado-detalle" className="onboarding-seccion">
            Cómo le fue en cada pregunta
          </h5>
          <ol className="onboarding-detalle">
            {detalle.map((d) => {
              const completa = Number(d.obtenidos) >= Number(d.puntos);
              const nada = Number(d.obtenidos) === 0;
              return (
                <li key={d.numero}>
                  <Icon
                    name={
                      completa
                        ? "check-circle-fill"
                        : nada
                          ? "x-circle-fill"
                          : "dash-circle-fill"
                    }
                    className={`onboarding-detalle__icono onboarding-detalle__icono--${completa ? "bien" : nada ? "mal" : "parcial"}`}
                    label={completa ? "Bien" : nada ? "Mal" : "En parte"}
                  />
                  <span className="onboarding-detalle__texto">{d.texto}</span>
                  <span className="onboarding-detalle__puntos">
                    {numero(d.obtenidos)} de {numero(d.puntos)}
                  </span>
                </li>
              );
            })}
          </ol>
          {!resultado.aprobado && (
            <p className="mz-faint mz-small mb-0">
              Repase el material antes de volver a intentarlo.
            </p>
          )}
        </section>
      )}

      <div className="mz-actions justify-content-end">
        {!resultado.aprobado && quedan > 0 ? (
          <>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onRepasar}
            >
              <Icon name="book" /> Repasar el material
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onReintentar}
            >
              <Icon name="arrow-repeat" /> Intentar de nuevo
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onCerrar}
          >
            Volver al plan
          </button>
        )}
      </div>
    </div>
  );
}

/** La evaluación de un material: responder y ver la nota (sobre 10) con qué
 * reforzar. Con tiempo límite (22/10/2026) el reloj es del servidor: corre
 * desde «Comenzar» y no se detiene al cerrar la ventana; lo respondido se
 * guarda solo y, al llegar a cero, se envía con lo que haya. */
function Evaluacion({ material, onTerminada, onRepasar, onCerrar }) {
  const conReloj = Boolean(material.tiempo_limite);
  const [comenzada, setComenzada] = useState(
    !conReloj || material.segundos_restantes != null,
  );
  const [ronda, setRonda] = useState(0);
  const [datos, setDatos] = useState(null);
  const [respuestas, setRespuestas] = useState({});
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [faltan, setFaltan] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [restantes, setRestantes] = useState(null);
  const [anuncio, setAnuncio] = useState("");
  const vence = useRef(null);
  const enviada = useRef(false);
  const cambiada = useRef(false);
  const ultimas = useRef({});
  const avisos = useRef(new Set());
  ultimas.current = respuestas;
  // Si el borrador no se guarda, se dice (antes fallaba en silencio y la
  // persona creía que sus respuestas estaban a salvo); se reintenta con el
  // próximo cambio (auditoría UX/UI, fase 2, 28/10/2026).
  const [borradorFallo, setBorradorFallo] = useState(false);

  useEffect(() => {
    if (!comenzada) return;
    setDatos(null);
    capacitacionService
      .evaluacion(material.id)
      .then((d) => {
        setDatos(d);
        setRespuestas(d.borrador ?? {});
        if (d.segundos_restantes != null) {
          vence.current = Date.now() + d.segundos_restantes * 1000;
          setRestantes(d.segundos_restantes);
        }
      })
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo abrir la evaluación.")),
      );
  }, [comenzada, material.id, ronda]);

  const terminar = useCallback(
    (r) => {
      enviada.current = true;
      setResultado(r);
      onTerminada();
    },
    [onTerminada],
  );

  const enviar = useCallback(
    async (agotado = false) => {
      if (enviada.current) return;
      enviada.current = true;
      setEnviando(true);
      setError(null);
      try {
        terminar(
          await capacitacionService.responder(
            material.id,
            ultimas.current,
            agotado,
          ),
        );
      } catch (err) {
        enviada.current = false;
        setError(mensajeDeError(err, "No se pudo enviar la evaluación."));
      } finally {
        setEnviando(false);
      }
    },
    [material.id, terminar],
  );

  // El reloj: al llegar a cero se envía lo que haya. A los 5 y al 1 minuto
  // se anuncia una vez (el color no lo oye un lector de pantalla).
  const relojActivo = restantes !== null;
  useEffect(() => {
    if (!relojActivo || resultado) return undefined;
    const intervalo = setInterval(() => {
      const quedan = Math.max(
        0,
        Math.ceil((vence.current - Date.now()) / 1000),
      );
      setRestantes(quedan);
      for (const [umbral, texto] of [
        [300, "Quedan 5 minutos."],
        [60, "Queda 1 minuto: al llegar a cero se envía solo."],
      ]) {
        if (quedan <= umbral && !avisos.current.has(umbral)) {
          avisos.current.add(umbral);
          setAnuncio(texto);
        }
      }
      if (quedan === 0) {
        clearInterval(intervalo);
        enviar(true);
      }
    }, 1000);
    return () => clearInterval(intervalo);
  }, [relojActivo, resultado, enviar]);

  // El borrador: lo respondido se guarda solo, poco después de cada cambio.
  useEffect(() => {
    if (!conReloj || !datos || resultado || !cambiada.current) return undefined;
    const temporizador = setTimeout(() => {
      capacitacionService
        .guardarBorrador(material.id, respuestas)
        .then((r) => {
          setBorradorFallo(false);
          if (r.cerrada) terminar(r.resultado);
        })
        .catch(() => setBorradorFallo(true));
    }, ESPERA_BORRADOR);
    return () => clearTimeout(temporizador);
  }, [conReloj, datos, resultado, respuestas, material.id, terminar]);

  function responder(id, valor) {
    cambiada.current = true;
    setRespuestas((r) => ({ ...r, [id]: valor }));
    setFaltan((f) => f.filter((x) => x !== id));
  }

  function cerrar() {
    // El tiempo sigue: lo último respondido no se pierde.
    if (conReloj && datos && !resultado && cambiada.current)
      capacitacionService
        .guardarBorrador(material.id, ultimas.current)
        .catch(() => {});
    onCerrar();
  }

  /** Salir a medias: sin reloj se pierde lo respondido (pero no el
   * intento); con reloj no se pregunta, porque se guarda solo. */
  function guardClose() {
    if (resultado || conReloj || !cambiada.current) {
      cerrar();
      return false;
    }
    confirmar({
      titulo: "¿Salir sin enviar?",
      mensaje:
        "Sus respuestas se pierden, pero no se gasta un intento: podrá rendirla después.",
      accion: "Salir sin enviar",
      cancelar: "Seguir respondiendo",
    }).then((si) => si && cerrar());
    return false;
  }

  // Con los intentos que dice el servidor al abrir (también al reintentar).
  const intentosMax =
    material.intentos_max ??
    (material.intentos ?? 0) + (datos?.intentos_restantes ?? 1);
  const intentoActual = datos
    ? intentosMax - datos.intentos_restantes + 1
    : (material.intentos ?? 0) + 1;

  async function alEnviar(e) {
    e.preventDefault();
    // Qué falta, dicho y enfocado (antes el botón quedaba gris y mudo).
    const pendientes = datos.preguntas
      .filter((p) => !respondida(p, respuestas[p.id]))
      .map((p) => p.id);
    setFaltan(pendientes);
    if (pendientes.length) {
      requestAnimationFrame(() =>
        document
          .querySelector(
            `#pregunta-${pendientes[0]} input, #pregunta-${pendientes[0]} select`,
          )
          ?.focus(),
      );
      return;
    }
    // Enviar gasta un intento: se confirma.
    const si = await confirmar({
      titulo: "¿Enviar sus respuestas?",
      mensaje: `Usará el intento ${intentoActual} de ${intentosMax}. Después de enviarlas no podrá cambiarlas.`,
      accion: "Enviar",
      cancelar: "Revisar de nuevo",
      peligro: false,
    });
    if (si) enviar(false);
  }

  function reintentar() {
    enviada.current = false;
    cambiada.current = false;
    avisos.current = new Set();
    setResultado(null);
    setRespuestas({});
    setFaltan([]);
    setError(null);
    setRestantes(null);
    if (conReloj) setComenzada(false);
    else setRonda((r) => r + 1);
  }

  const respondidas = datos
    ? datos.preguntas.filter((p) => respondida(p, respuestas[p.id])).length
    : 0;
  const numeroDe = (id) =>
    (datos?.preguntas.findIndex((p) => p.id === id) ?? -1) + 1;

  return (
    <Ventana
      titulo={`Evaluación · ${material.titulo}`}
      onCerrar={cerrar}
      guardClose={guardClose}
      confirmarAlDescartar={false}
      guardado={Boolean(resultado)}
      ancha
    >
      <p className="visually-hidden" aria-live="assertive">
        {anuncio}
      </p>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {/* Mientras llegan las preguntas, la ventana no queda en blanco. */}
      {comenzada && !datos && !error && <EstadoDeCarga cargando />}
      {!comenzada && (
        <div className="mz-stack">
          <div className="mz-alert mz-alert--warn" role="status">
            <Icon name="stopwatch" />
            <span>
              Esta evaluación tiene{" "}
              <strong>{material.tiempo_limite} minutos</strong>. El tiempo
              empieza al pulsar «Comenzar» y no se detiene aunque cierre esta
              ventana. Sus respuestas se guardan solas; si el tiempo se acaba,
              se califica lo que haya respondido.
            </span>
          </div>
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Ahora no
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setComenzada(true)}
            >
              <Icon name="play-fill" /> Comenzar
            </button>
          </div>
        </div>
      )}
      {resultado && (
        <Resultado
          resultado={resultado}
          onReintentar={reintentar}
          onRepasar={() => onRepasar(material)}
          onCerrar={onCerrar}
        />
      )}
      {datos && !resultado && (
        <form className="mz-stack" onSubmit={alEnviar} noValidate>
          {restantes !== null && (
            <div
              className={`onboarding-reloj${restantes <= 60 ? " onboarding-reloj--poco" : ""}`}
              role="timer"
              aria-label="Tiempo restante"
            >
              <Icon name="stopwatch" /> Tiempo restante:{" "}
              <strong>{formatoReloj(restantes)}</strong>
              {restantes <= 60 && restantes > 0 && (
                <span> · se enviará solo al llegar a cero</span>
              )}
            </div>
          )}
          {/* Las reglas, a la vista y legibles (antes en gris de 11,5 px). */}
          <div
            className="mz-alert mz-alert--info onboarding-reglas"
            role="note"
          >
            <Icon name="info-circle" />
            <span>
              {plural(datos.preguntas.length, "pregunta", "preguntas")} · 10
              puntos · aprueba con {numero(datos.material.nota_minima / 10)} /
              10 ({datos.material.nota_minima} %) · intento {intentoActual} de{" "}
              {intentosMax}
              {conReloj && " · sus respuestas se guardan solas"}
            </span>
          </div>
          {borradorFallo && (
            <div className="mz-alert mz-alert--warn" role="status">
              <Icon name="exclamation-triangle" />
              No se pudieron guardar sus últimas respuestas. Se volverá a
              intentar con su próximo cambio; no cierre la ventana hasta
              enviarlas.
            </div>
          )}
          {faltan.length > 0 && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="exclamation-circle" />
              <span>
                {faltan.length === 1
                  ? `Falta responder la pregunta ${numeroDe(faltan[0])}.`
                  : `Faltan ${faltan.length} preguntas: ${faltan.map(numeroDe).join(", ")}.`}
              </span>
            </div>
          )}
          {datos.preguntas.map((p, i) => (
            <Pregunta
              key={p.id}
              p={p}
              i={i}
              respuesta={respuestas[p.id]}
              falta={faltan.includes(p.id)}
              onResponder={(valor) => responder(p.id, valor)}
            />
          ))}
          <div className="mz-actions justify-content-end align-items-center">
            <span className="mz-small mz-faint me-auto" aria-live="polite">
              {respondidas} de {datos.preguntas.length} respondidas
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              data-no-descarta
              onClick={() => guardClose()}
            >
              {conReloj ? "Cerrar (el tiempo sigue)" : "Cancelar"}
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={enviando}
            >
              {enviando ? "Enviando…" : "Enviar respuestas"}
            </button>
          </div>
        </form>
      )}
    </Ventana>
  );
}

const ESTADO = {
  aprobado: ["aprobado", (m) => `Aprobado · ${m.mejor_puntaje} %`],
  agotado: ["agotado", (m) => `Sin intentos · ${m.mejor_puntaje} %`],
  porAprobar: ["por-aprobar", (m) => `Por aprobar · ${m.mejor_puntaje} %`],
  visto: ["visto", () => "Visto"],
  pendiente: ["pendiente", () => "Pendiente"],
};

/** El estado de un material, con su propia pill (antes tomaba prestadas las
 * de Perfiles de cargo y Sugerencias). */
function EstadoMaterial({ m }) {
  const clave = m.aprobado
    ? "aprobado"
    : m.agotado
      ? "agotado"
      : m.mejor_puntaje !== null
        ? "porAprobar"
        : m.visto
          ? "visto"
          : "pendiente";
  const [clase, texto] = ESTADO[clave];
  return (
    <span className={`onboarding-estado onboarding-estado--${clase}`}>
      {texto(m)}
    </span>
  );
}

/** Por qué todavía no se puede evaluar, en texto (antes solo en un
 * `title`, que no ven el teclado, el lector de pantalla ni el teléfono). */
function motivoSinEvaluar(m) {
  if (!m.preguntas) return "Este material no tiene evaluación.";
  if (!m.visto) return "Abra el material para habilitar su evaluación.";
  if (m.agotado)
    return `Usó sus ${plural(m.intentos_max, "intento", "intentos")}: pida a Talento Humano que se los devuelva.`;
  return null;
}

/**
 * Institucional → Mi onboarding: los materiales de la empresa, de su área y
 * de su cargo; cada uno se revisa (el PDF y la presentación en el visor del
 * sistema) y se evalúa. Muestra el avance, los puntajes y qué reforzar.
 */
export function MiOnboardingPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  // El fallo al cargar va aparte, con «Reintentar»; antes la pantalla quedaba
  // en blanco mientras cargaba (auditoría UX/UI, fase 2, 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);
  const [leyendo, setLeyendo] = useState(null);
  const [visor, setVisor] = useState(null);
  const [evaluando, setEvaluando] = useState(null);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    return capacitacionService
      .miOnboarding()
      .then(setDatos)
      .catch((err) =>
        setErrorCarga(mensajeDeError(err, "No se pudo cargar su onboarding.")),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function marcarVisto(m) {
    if (m.visto) return;
    try {
      await capacitacionService.marcarVisto(m.id);
      setLeyendo((l) => (l && l.id === m.id ? { ...l, visto: true } : l));
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo registrar que lo revisó."));
    }
  }

  // Al cerrar una ventana, el foco vuelve a la fila de su material.
  const volverA = (id) =>
    requestAnimationFrame(() =>
      document.getElementById(`material-${id}-revisar`)?.focus(),
    );

  const porcentaje =
    datos && datos.total
      ? Math.round((100 * datos.aprobados) / datos.total)
      : 0;

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Mi onboarding</h2>
          <p className="mz-desc">
            Su capacitación: lo de la empresa, lo de su área y lo de su cargo.
            Revise cada material y apruebe su evaluación.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <EstadoDeCarga
        cargando={datos === null && !errorCarga}
        error={errorCarga}
        onReintentar={cargar}
        vacio={datos?.total === 0}
        textoVacio="Todavía no hay materiales de capacitación para usted."
      />

      {datos && datos.total > 0 && (
        <section className="mz-card" aria-label="Su avance">
          <div className="mz-card-body onboarding-avance">
            <div>
              <strong>
                {datos.aprobados} de {datos.total} materiales aprobados
              </strong>
              <div
                className="onboarding-barra"
                role="progressbar"
                aria-valuenow={porcentaje}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Avance del onboarding"
              >
                <span style={{ width: `${porcentaje}%` }} />
              </div>
            </div>
            <div className="onboarding-avance__datos">
              {datos.promedio !== null && (
                <span title="Con su mejor intento de cada material evaluado">
                  Promedio: <strong>{datos.promedio} %</strong>{" "}
                  <small className="mz-faint">(su mejor intento)</small>
                </span>
              )}
              {datos.completado_en ? (
                <span className="onboarding-estado onboarding-estado--aprobado">
                  Completado el {formatearFecha(datos.completado_en)}
                </span>
              ) : (
                datos.fecha_limite && (
                  <span className={datos.vencido ? "text-danger" : undefined}>
                    {datos.vencido ? "Venció el " : "Fecha límite: "}
                    {formatearFecha(datos.fecha_limite)}
                  </span>
                )
              )}
            </div>
          </div>
        </section>
      )}

      {datos &&
        GRUPOS.map(([alcance, titulo, icono]) => {
          const lista = datos.materiales.filter((m) => m.alcance === alcance);
          if (!lista.length) return null;
          return (
            <section key={alcance} className="mz-card">
              <div className="mz-card-body">
                <h3 className="inicio-titulo">
                  <Icon name={icono} /> {titulo}
                  {lista[0].de && (
                    <span className="mz-faint mz-small"> · {lista[0].de}</span>
                  )}
                </h3>
                <ul className="perfil-cargo-lista onboarding-plan">
                  {lista.map((m) => {
                    const motivo = motivoSinEvaluar(m);
                    return (
                      <li key={m.id}>
                        <span className="perfil-cargo-lista__nombre">
                          <strong>{m.titulo}</strong>
                          <small className="mz-faint">
                            {" "}
                            · {m.formatos.join(" + ")}
                          </small>
                          {m.descripcion && (
                            <small className="d-block mz-faint">
                              {m.descripcion}
                            </small>
                          )}
                          {m.preguntas > 0 && !m.aprobado && (
                            <small className="d-block onboarding-plan__datos">
                              {plural(m.preguntas, "pregunta", "preguntas")} ·
                              aprueba con {m.nota_minima} % · intento{" "}
                              {Math.min(m.intentos + 1, m.intentos_max)} de{" "}
                              {m.intentos_max}
                              {m.tiempo_limite
                                ? ` · ${m.tiempo_limite} min`
                                : ""}
                            </small>
                          )}
                          {motivo && !m.aprobado && (
                            <small
                              id={`material-${m.id}-motivo`}
                              className="d-block onboarding-plan__motivo"
                            >
                              <Icon name="info-circle" /> {motivo}
                            </small>
                          )}
                        </span>
                        <EstadoMaterial m={m} />
                        <span className="onboarding-plan__acciones">
                          <button
                            type="button"
                            id={`material-${m.id}-revisar`}
                            className="btn btn-outline-primary btn-sm"
                            onClick={() => {
                              setError(null);
                              setLeyendo(m);
                            }}
                          >
                            <Icon name="book" /> Revisar
                          </button>
                          {!m.aprobado && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={Boolean(motivo)}
                              aria-describedby={
                                motivo ? `material-${m.id}-motivo` : undefined
                              }
                              onClick={() => setEvaluando(m)}
                            >
                              {m.segundos_restantes != null ? (
                                <>
                                  <Icon name="stopwatch" /> Continuar (quedan{" "}
                                  {formatoReloj(m.segundos_restantes)})
                                </>
                              ) : (
                                <>
                                  <Icon name="pencil-square" /> Evaluarme
                                </>
                              )}
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })}

      {leyendo && (
        <RevisarMaterial
          material={leyendo}
          onVisto={marcarVisto}
          onAbrirArchivo={(blob, tipo) =>
            setVisor({ material: leyendo, blob, tipo })
          }
          onEvaluar={(m) => {
            setLeyendo(null);
            setEvaluando({ ...m, visto: true });
          }}
          onCerrar={() => {
            const id = leyendo.id;
            setLeyendo(null);
            volverA(id);
          }}
        />
      )}
      {visor?.tipo === "pdf" && (
        <VisorPdf
          titulo={visor.material.titulo}
          blob={visor.blob}
          nombreArchivo={
            visor.material.archivo_nombre || `${visor.material.titulo}.pdf`
          }
          onCerrar={() => setVisor(null)}
        />
      )}
      {visor?.tipo === "pptx" && (
        <VisorPresentacion
          titulo={visor.material.titulo}
          blob={visor.blob}
          nombreArchivo={
            visor.material.archivo_nombre || `${visor.material.titulo}.pptx`
          }
          onCerrar={() => setVisor(null)}
        />
      )}
      {evaluando && (
        <Evaluacion
          material={evaluando}
          onTerminada={cargar}
          onRepasar={(m) => {
            setEvaluando(null);
            setLeyendo({ ...m, visto: true });
          }}
          onCerrar={() => {
            const id = evaluando.id;
            setEvaluando(null);
            volverA(id);
          }}
        />
      )}
    </div>
  );
}
