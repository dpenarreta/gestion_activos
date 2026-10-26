import { useEffect, useState } from "react";

import { nominaService } from "../../api/nominaService";
import { Icon } from "../../components/common/Icon/Icon";
import {
  MarcoPdf,
  useUrlDePdf,
} from "../../components/common/VisorPdf/VisorPdf";
import "../../components/common/VisorPdf/VisorPdf.css";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { descargarBlob } from "../../utils/descargas";

/**
 * El visor del rol de pagos con su conformidad: la persona dice si está de
 * acuerdo con la información o deja una observación (le llega a Talento
 * Humano). Si intenta cerrar sin responder —la X, Escape, un clic fuera o
 * cerrar la pestaña— se le advierte que cerrar es aceptar que el rol es
 * correcto, y así queda registrado.
 */
export function VisorRolPagos({
  titulo,
  blob,
  nombreArchivo,
  consulta,
  propio,
  conformidad,
  correccion = null,
  onConformidad,
  onCerrar,
}) {
  const url = useUrlDePdf(blob);
  const pendiente = propio && !conformidad;
  const [observando, setObservando] = useState(false);
  const [observacion, setObservacion] = useState("");
  const [advirtiendo, setAdvirtiendo] = useState(false);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  function intentarCerrar() {
    if (pendiente) setAdvirtiendo(true);
    else onCerrar();
  }

  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: intentarCerrar,
  });

  // Cerrar la pestaña o recargar con el rol sin responder: el navegador
  // pregunta antes de irse.
  useEffect(() => {
    if (!pendiente) return undefined;
    function avisar(evento) {
      evento.preventDefault();
      evento.returnValue = "";
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [pendiente]);

  async function responder(tipo, cerrarDespues = false) {
    setGuardando(true);
    setError(null);
    try {
      const respuesta = await nominaService.conformidad(
        consulta,
        tipo,
        tipo === "observacion" ? observacion : "",
      );
      onConformidad(respuesta);
      setObservando(false);
      setAdvirtiendo(false);
      if (cerrarDespues) onCerrar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo registrar su respuesta."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="visor-pdf"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visor-rol-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="visor-pdf__cabecera">
          <Icon name="file-earmark-pdf" className="visor-pdf__icono" />
          <h3 id="visor-rol-titulo">{titulo}</h3>
          {url && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => descargarBlob(blob, nombreArchivo)}
            >
              <Icon name="download" /> Descargar
            </button>
          )}
          <button
            type="button"
            className="mz-close"
            onClick={intentarCerrar}
            aria-label="Cerrar visor"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="visor-pdf__cuerpo">
          <MarcoPdf titulo={titulo} url={url} />
        </div>

        {propio && (
          <div
            className={`visor-rol__conformidad${pendiente ? " is-pendiente" : ""}`}
            aria-label="Conformidad con el rol de pagos"
            role="region"
          >
            {error && (
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                {error}
              </div>
            )}
            {correccion && !conformidad && (
              <p className="visor-rol__correccion mb-0">
                <Icon name="arrow-repeat" /> Talento Humano corrigió este rol
                {correccion.nota && <>: «{correccion.nota}»</>}. Revíselo y
                confirme si ahora está de acuerdo.
              </p>
            )}
            {conformidad ? (
              <p className="mb-0" role="status">
                <Icon name="check2-circle" /> Respuesta registrada:{" "}
                <strong>{conformidad.conformidad_display}</strong>
                {conformidad.fecha && (
                  <span className="mz-faint">
                    {" "}
                    · el {conformidad.dia} {conformidad.fecha} a las{" "}
                    {conformidad.hora}
                    {conformidad.ip && ` desde la IP ${conformidad.ip}`}
                  </span>
                )}
                .
                {conformidad.conformidad !== "observacion" && (
                  <span className="d-block mz-small mz-faint">
                    La aceptación es definitiva: este es el rol que aceptó y
                    queda guardado como constancia. Si encuentra algo, coméntelo
                    con Talento Humano.
                  </span>
                )}
              </p>
            ) : observando ? (
              <div className="visor-rol__observacion">
                <label
                  className="form-label mz-small"
                  htmlFor="rol-observacion"
                >
                  ¿Qué no está correcto? Se le avisará a Talento Humano.
                </label>
                <textarea
                  id="rol-observacion"
                  rows={2}
                  maxLength={2000}
                  className="form-control form-control-sm"
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                />
                <div className="mz-actions justify-content-end">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => setObservando(false)}
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!observacion.trim() || guardando}
                    onClick={() => responder("observacion")}
                  >
                    Enviar observación
                  </button>
                </div>
              </div>
            ) : (
              <div className="visor-rol__pregunta">
                <span>
                  <strong>
                    ¿Está de acuerdo con la información de su rol?
                  </strong>{" "}
                  <span className="mz-faint">
                    Si cierra sin responder, se toma como aceptado.
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setObservando(true)}
                >
                  <Icon name="chat-left-text" /> Tengo una observación
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={guardando}
                  onClick={() => responder("conforme")}
                >
                  <Icon name="check-lg" /> Estoy de acuerdo
                </button>
              </div>
            )}
          </div>
        )}

        {advirtiendo && (
          <div className="visor-rol__aviso" role="presentation">
            <div
              className="mz-modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="visor-rol-aviso"
              aria-describedby="visor-rol-aviso-texto"
            >
              <div className="mz-panel-body mz-stack">
                <h3 id="visor-rol-aviso" className="h6 mb-0">
                  <Icon name="exclamation-triangle" /> ¿Cerrar sin responder?
                </h3>
                <p id="visor-rol-aviso-texto" className="mb-0">
                  Si cierra ahora, se registrará que{" "}
                  <strong>acepta que su rol de pagos es correcto</strong>. Si
                  algo no está bien, vuelva y deje una observación.
                </p>
                <div className="mz-actions justify-content-end">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => setAdvirtiendo(false)}
                  >
                    Volver al rol
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={guardando}
                    onClick={() => responder("conforme_al_cerrar", true)}
                  >
                    Cerrar y aceptar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
