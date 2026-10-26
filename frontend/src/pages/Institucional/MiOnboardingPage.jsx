import { useCallback, useEffect, useRef, useState } from "react";

import { capacitacionService } from "../../api/capacitacionService";
import { Icon } from "../../components/common/Icon/Icon";
import { VisorPdf } from "../../components/common/VisorPdf/VisorPdf";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import "./Institucional.css";
import { descargarBlob } from "../../utils/descargas";

const GRUPOS = [
  ["empresa", "De la empresa", "building"],
  ["unidad", "De su área", "diagram-3"],
  ["cargo", "De su cargo", "briefcase"],
];

function Ventana({ titulo, onCerrar, children, ancha = false }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
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
        aria-label={titulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
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

/** Un material, con todo lo que trae: el texto, su archivo (el PDF se abre
 * en el visor; la presentación se descarga) y el video. */
function RevisarMaterial({ material, onAbrirPdf, onCerrar }) {
  const [error, setError] = useState(null);

  async function archivo() {
    setError(null);
    try {
      const blob = await capacitacionService.archivo(material.id);
      if (material.archivo_es_pdf) {
        onAbrirPdf(blob);
        return;
      }
      descargarBlob(blob, material.archivo_nombre || `${material.titulo}.pptx`);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo abrir el archivo."));
    }
  }

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
        <div className="onboarding-texto">{material.contenido}</div>
      )}
      {(material.tiene_archivo || material.url) && (
        <div className="d-flex flex-wrap gap-2 mt-3">
          {material.tiene_archivo && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={archivo}
            >
              <Icon
                name={
                  material.archivo_es_pdf
                    ? "file-earmark-pdf"
                    : "file-earmark-slides"
                }
              />{" "}
              {material.archivo_es_pdf
                ? "Ver el PDF"
                : "Descargar la presentación"}
            </button>
          )}
          {material.url && (
            <a
              className="btn btn-outline-primary btn-sm"
              href={material.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="play-btn" /> Ver el video
            </a>
          )}
        </div>
      )}
      <div className="mz-actions justify-content-end mt-3">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onCerrar}
        >
          Terminé de revisar
        </button>
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
function Pregunta({ p, i, respuesta, onResponder }) {
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
      <p className="mb-0">
        {p.segmentos.map((s, k) => {
          if (s !== null) return <span key={k}>{s}</span>;
          hueco += 1;
          const n = hueco;
          return (
            <input
              key={k}
              className="form-control form-control-sm onboarding-hueco"
              aria-label={`Espacio ${n + 1} de la pregunta ${i + 1}`}
              maxLength={200}
              value={palabras[n] ?? ""}
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
                  {d}
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
    <fieldset className="onboarding-pregunta">
      <legend>
        {i + 1}. {p.tipo === "completar" ? NOMBRE_TIPO.completar : p.texto}
      </legend>
      <small className="mz-faint">
        {NOMBRE_TIPO[p.tipo] ?? ""} · {Number(p.puntos).toLocaleString("es-EC")}{" "}
        puntos
      </small>
      {cuerpo}
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

/** La evaluación de un material: responder y ver la nota (sobre 10) con qué
 * reforzar. Con tiempo límite (22/10/2026) el reloj es del servidor: corre
 * desde «Comenzar» y no se detiene al cerrar la ventana; lo respondido se
 * guarda solo y, al llegar a cero, se envía con lo que haya. */
function Evaluacion({ material, onTerminada, onCerrar }) {
  const conReloj = Boolean(material.tiempo_limite);
  const [comenzada, setComenzada] = useState(
    !conReloj || material.segundos_restantes != null,
  );
  const [datos, setDatos] = useState(null);
  const [respuestas, setRespuestas] = useState({});
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [restantes, setRestantes] = useState(null);
  const vence = useRef(null);
  const enviada = useRef(false);
  const cambiada = useRef(false);
  const ultimas = useRef({});
  ultimas.current = respuestas;

  useEffect(() => {
    if (!comenzada) return;
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
  }, [comenzada, material.id]);

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

  // El reloj: al llegar a cero se envía lo que haya.
  const relojActivo = restantes !== null;
  useEffect(() => {
    if (!relojActivo || resultado) return undefined;
    const intervalo = setInterval(() => {
      const quedan = Math.max(
        0,
        Math.ceil((vence.current - Date.now()) / 1000),
      );
      setRestantes(quedan);
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
          if (r.cerrada) terminar(r.resultado);
        })
        .catch(() => {});
    }, ESPERA_BORRADOR);
    return () => clearTimeout(temporizador);
  }, [conReloj, datos, resultado, respuestas, material.id, terminar]);

  function responder(id, valor) {
    cambiada.current = true;
    setRespuestas((r) => ({ ...r, [id]: valor }));
  }

  function cerrar() {
    // El tiempo sigue: lo último respondido no se pierde.
    if (conReloj && datos && !resultado && cambiada.current)
      capacitacionService
        .guardarBorrador(material.id, ultimas.current)
        .catch(() => {});
    onCerrar();
  }

  const completas =
    datos && datos.preguntas.every((p) => respondida(p, respuestas[p.id]));

  return (
    <Ventana titulo={`Evaluación · ${material.titulo}`} onCerrar={cerrar} ancha>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
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
        <div className="mz-stack">
          {resultado.por_tiempo && (
            <div className="mz-alert mz-alert--warn" role="alert">
              <Icon name="stopwatch" />
              Se acabó el tiempo. Guardamos automáticamente todo lo que había
              respondido y con eso se calificó.
            </div>
          )}
          <div
            className={`mz-alert ${resultado.aprobado ? "mz-alert--ok" : "mz-alert--warn"}`}
            role="status"
          >
            <Icon
              name={resultado.aprobado ? "trophy" : "exclamation-triangle"}
            />
            <span>
              Su nota:{" "}
              <strong>
                {Number(resultado.nota).toLocaleString("es-EC")} / 10
              </strong>{" "}
              ({resultado.puntaje} %).{" "}
              {resultado.aprobado
                ? "¡Aprobó!"
                : `Necesita el ${resultado.nota_minima} % para aprobar. Le quedan ${resultado.intentos_restantes} intentos.`}
            </span>
          </div>
          {resultado.a_reforzar.length > 0 && (
            <section aria-label="Oportunidades de mejora">
              <strong className="mz-small">Para reforzar</strong>
              <ul className="onboarding-reforzar">
                {resultado.a_reforzar.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <p className="mz-faint mz-small mb-0">
                Repase el material antes de volver a intentarlo.
              </p>
            </section>
          )}
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onCerrar}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
      {datos && !resultado && (
        <form
          className="mz-stack"
          onSubmit={(e) => {
            e.preventDefault();
            enviar(false);
          }}
        >
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
          <p className="mz-faint mz-small mb-0">
            La nota es sobre 10 · Aprueba con el {datos.material.nota_minima} %
            · Intentos restantes: {datos.intentos_restantes}
            {conReloj && " · Sus respuestas se guardan solas"}
          </p>
          {datos.preguntas.map((p, i) => (
            <Pregunta
              key={p.id}
              p={p}
              i={i}
              respuesta={respuestas[p.id]}
              onResponder={(valor) => responder(p.id, valor)}
            />
          ))}
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={cerrar}
            >
              {conReloj ? "Cerrar (el tiempo sigue)" : "Cancelar"}
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!completas || enviando}
            >
              {enviando ? "Enviando…" : "Enviar respuestas"}
            </button>
          </div>
        </form>
      )}
    </Ventana>
  );
}

function EstadoMaterial({ m }) {
  if (m.aprobado)
    return (
      <span className="perfil-cargo-estado perfil-cargo-estado--completo">
        Aprobado · {m.mejor_puntaje} %
      </span>
    );
  if (m.agotado)
    return (
      <span className="sugerencia-estado sugerencia-estado--alto">
        Sin intentos · {m.mejor_puntaje} %
      </span>
    );
  if (m.mejor_puntaje !== null)
    return (
      <span className="perfil-cargo-estado perfil-cargo-estado--parcial">
        Por aprobar · {m.mejor_puntaje} %
      </span>
    );
  return (
    <span className="perfil-cargo-estado perfil-cargo-estado--vacio">
      {m.visto ? "Visto" : "Pendiente"}
    </span>
  );
}

/**
 * Institucional → Mi onboarding: los materiales de la empresa, de su área y
 * de su cargo; cada uno se revisa y se evalúa. Muestra el avance, los
 * puntajes y qué reforzar.
 */
export function MiOnboardingPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [leyendo, setLeyendo] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [evaluando, setEvaluando] = useState(null);

  const cargar = useCallback(
    () =>
      capacitacionService
        .miOnboarding()
        .then(setDatos)
        .catch((err) =>
          setError(mensajeDeError(err, "No se pudo cargar su onboarding.")),
        ),
    [],
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function abrir(m) {
    setError(null);
    try {
      await capacitacionService.marcarVisto(m.id);
      setLeyendo(m);
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo abrir el material."));
    }
  }

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

      {datos && datos.total === 0 && (
        <p className="mz-faint">
          Todavía no hay materiales de capacitación para usted.
        </p>
      )}

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
                <span>
                  Promedio: <strong>{datos.promedio}</strong>
                </span>
              )}
              {datos.completado_en ? (
                <span className="perfil-cargo-estado perfil-cargo-estado--completo">
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
                <h4 className="inicio-titulo">
                  <Icon name={icono} /> {titulo}
                  {lista[0].de && (
                    <span className="mz-faint mz-small"> · {lista[0].de}</span>
                  )}
                </h4>
                <ul className="perfil-cargo-lista">
                  {lista.map((m) => (
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
                      </span>
                      <EstadoMaterial m={m} />
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => abrir(m)}
                      >
                        <Icon name="book" /> Revisar
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={
                          !m.visto || m.aprobado || m.agotado || !m.preguntas
                        }
                        title={
                          !m.visto
                            ? "Revise el material primero"
                            : m.agotado
                              ? "Sin intentos: pídalos a Talento Humano"
                              : undefined
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
                            {m.tiempo_limite ? ` · ${m.tiempo_limite} min` : ""}
                          </>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}

      {leyendo && (
        <RevisarMaterial
          material={leyendo}
          onAbrirPdf={(blob) => setPdf({ material: leyendo, blob })}
          onCerrar={() => setLeyendo(null)}
        />
      )}
      {pdf && (
        <VisorPdf
          titulo={pdf.material.titulo}
          blob={pdf.blob}
          nombreArchivo={`${pdf.material.titulo}.pdf`}
          onCerrar={() => setPdf(null)}
        />
      )}
      {evaluando && (
        <Evaluacion
          material={evaluando}
          onTerminada={cargar}
          onCerrar={() => setEvaluando(null)}
        />
      )}
    </div>
  );
}
