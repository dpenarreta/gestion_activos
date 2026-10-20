import { useCallback, useEffect, useState } from "react";

import { capacitacionService } from "../../api/capacitacionService";
import { Icon } from "../../components/common/Icon/Icon";
import { VisorPdf } from "../../components/common/VisorPdf/VisorPdf";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import "./Institucional.css";

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
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = material.archivo_nombre || `${material.titulo}.pptx`;
      enlace.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
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

/** La evaluación de un material: responder y ver el puntaje con qué
 * reforzar. */
function Evaluacion({ material, onTerminada, onCerrar }) {
  const [datos, setDatos] = useState(null);
  const [respuestas, setRespuestas] = useState({});
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    capacitacionService
      .evaluacion(material.id)
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo abrir la evaluación.")),
      );
  }, [material.id]);

  async function enviar(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      setResultado(
        await capacitacionService.responder(material.id, respuestas),
      );
      onTerminada();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar la evaluación."));
    } finally {
      setEnviando(false);
    }
  }

  const completas =
    datos && datos.preguntas.every((p) => respuestas[p.id] !== undefined);

  return (
    <Ventana
      titulo={`Evaluación · ${material.titulo}`}
      onCerrar={onCerrar}
      ancha
    >
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {resultado && (
        <div className="mz-stack">
          <div
            className={`mz-alert ${resultado.aprobado ? "mz-alert--ok" : "mz-alert--warn"}`}
            role="status"
          >
            <Icon
              name={resultado.aprobado ? "trophy" : "exclamation-triangle"}
            />
            <span>
              Su puntaje: <strong>{resultado.puntaje} / 100</strong>.{" "}
              {resultado.aprobado
                ? "¡Aprobó!"
                : `Necesita ${resultado.nota_minima} para aprobar. Le quedan ${resultado.intentos_restantes} intentos.`}
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
        <form className="mz-stack" onSubmit={enviar}>
          <p className="mz-faint mz-small mb-0">
            Nota mínima: {datos.material.nota_minima} / 100 · Intentos
            restantes: {datos.intentos_restantes}
          </p>
          {datos.preguntas.map((p, i) => (
            <fieldset key={p.id} className="onboarding-pregunta">
              <legend>
                {i + 1}. {p.texto}
              </legend>
              {p.opciones.map((o) => (
                <label key={o.id} className="form-check">
                  <input
                    type="radio"
                    className="form-check-input"
                    name={`pregunta-${p.id}`}
                    checked={respuestas[p.id] === o.id}
                    onChange={() =>
                      setRespuestas((r) => ({ ...r, [p.id]: o.id }))
                    }
                  />{" "}
                  <span className="form-check-label">{o.texto}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cancelar
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
        Aprobado · {m.mejor_puntaje}
      </span>
    );
  if (m.agotado)
    return (
      <span className="sugerencia-estado sugerencia-estado--alto">
        Sin intentos · {m.mejor_puntaje}
      </span>
    );
  if (m.mejor_puntaje !== null)
    return (
      <span className="perfil-cargo-estado perfil-cargo-estado--parcial">
        Por aprobar · {m.mejor_puntaje}
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
                        <Icon name="pencil-square" /> Evaluarme
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
