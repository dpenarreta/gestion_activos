import { useCallback, useEffect, useState } from "react";

import { matrizService } from "../../api/matrizService";
import { ConfirmDialog } from "../../components/common/ConfirmDialog/ConfirmDialog";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { fechaHora } from "./formatoMatriz";
import { MotivoModal } from "./MotivoModal";
import { VisorPdfModal, descargarDocumento } from "./VisorPdfModal";

function tamano(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * La pestaña Documentos del período (§15.4): los válidos —ver, descargar,
 * rechazar— y los rechazados, en rojo con su motivo, que se pueden eliminar.
 * Eliminar es lógico: el archivo se conserva.
 */
export function DocumentosDelPeriodo({ periodo, version, onCambio }) {
  const [documentos, setDocumentos] = useState(null);
  const [error, setError] = useState(null);
  const [viendo, setViendo] = useState(null);
  const [rechazando, setRechazando] = useState(null);
  const [eliminando, setEliminando] = useState(null);
  const [isEliminando, setIsEliminando] = useState(false);

  const puedeRechazar = periodo.acciones.includes("reject_document");
  const puedeCargar = periodo.acciones.includes("upload");
  const zona = periodo.empresa?.zona_horaria;

  const cargar = useCallback(() => {
    matrizService
      .documentos(periodo.id)
      .then(setDocumentos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar los documentos.")),
      );
  }, [periodo.id]);

  useEffect(() => {
    cargar();
  }, [cargar, version]);

  async function eliminar() {
    setIsEliminando(true);
    try {
      await matrizService.eliminarDocumento(eliminando.id);
      setEliminando(null);
      cargar();
      onCambio();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo eliminar el documento."));
      setEliminando(null);
    } finally {
      setIsEliminando(false);
    }
  }

  if (documentos === null && !error)
    return <div className="mz-empty">Cargando…</div>;

  const validos = (documentos ?? []).filter((d) => d.estado === "valido");
  const rechazados = (documentos ?? []).filter((d) => d.estado === "rechazado");

  return (
    <div>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {periodo.cerrado ? (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="lock" />
          El período está cerrado: sus documentos son de solo lectura.
        </div>
      ) : (
        !puedeCargar && (
          <div className="mz-alert mz-alert--info" role="status">
            <Icon name="info-circle" />
            Puede consultar las evidencias, pero no cargar ni eliminar en este
            período.
          </div>
        )
      )}

      {validos.length === 0 && rechazados.length === 0 && (
        <div className="mz-empty">
          <Icon name="folder2-open" />
          <div className="mz-strong">Sin documentos.</div>
          <div>Aún no se ha cargado evidencia para este período.</div>
        </div>
      )}

      {validos.length > 0 && (
        <div className="mz-section">
          <h4>Válidos</h4>
          {validos.map((doc) => (
            <div key={doc.id} className="mz-doc">
              <span className="mz-doc-ic">
                <Icon name="file-earmark-pdf" />
              </span>
              <div className="mz-doc-info">
                <strong>
                  {doc.nombre_original}{" "}
                  <span className="mz-faint">v{doc.version}</span>
                </strong>
                <span>
                  {tamano(doc.tamano)} · {fechaHora(doc.created_at, zona)} ·{" "}
                  {doc.subido_por?.nombre}
                </span>
              </div>
              <div className="mz-doc-actions">
                <button
                  type="button"
                  aria-label={`Ver ${doc.nombre_original}`}
                  title="Ver"
                  onClick={() => setViendo(doc)}
                >
                  <Icon name="eye" />
                </button>
                <button
                  type="button"
                  aria-label={`Descargar ${doc.nombre_original}`}
                  title="Descargar"
                  onClick={() => descargarDocumento(doc)}
                >
                  <Icon name="download" />
                </button>
                {puedeRechazar && (
                  <button
                    type="button"
                    aria-label={`Rechazar ${doc.nombre_original}`}
                    title="Rechazar"
                    onClick={() => setRechazando(doc)}
                  >
                    <Icon name="x-circle" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {rechazados.length > 0 && (
        <div className="mz-section">
          <h4>Rechazados</h4>
          {rechazados.map((doc) => (
            <div key={doc.id} className="mz-doc mz-doc--rejected">
              <span className="mz-doc-ic mz-doc-ic--bad">
                <Icon name="file-earmark-x" />
              </span>
              <div className="mz-doc-info">
                <strong>
                  {doc.nombre_original}{" "}
                  <span className="mz-faint">v{doc.version}</span>
                </strong>
                <span>
                  Rechazado por {doc.rechazado_por?.nombre}:{" "}
                  {doc.motivo_rechazo}
                </span>
              </div>
              {puedeCargar && (
                <div className="mz-doc-actions">
                  <button
                    type="button"
                    aria-label={`Eliminar ${doc.nombre_original}`}
                    title="Eliminar"
                    onClick={() => setEliminando(doc)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {viendo && (
        <VisorPdfModal
          documentos={validos}
          inicial={viendo}
          onCerrar={() => setViendo(null)}
        />
      )}
      {rechazando && (
        <MotivoModal
          titulo="Rechazar evidencia"
          subtitulo={rechazando.nombre_original}
          etiqueta="Motivo del rechazo"
          textoConfirmar="Rechazar"
          variante="danger"
          onCerrar={() => setRechazando(null)}
          onConfirmar={async (motivo) => {
            await matrizService.rechazarDocumento(rechazando.id, motivo);
            setRechazando(null);
            cargar();
            onCambio();
          }}
        />
      )}
      <ConfirmDialog
        isOpen={Boolean(eliminando)}
        title="Eliminar documento rechazado"
        message={
          eliminando
            ? `«${eliminando.nombre_original}» dejará de verse en el período. El archivo se conserva en el sistema.`
            : ""
        }
        confirmLabel="Eliminar"
        confirmVariant="danger"
        isLoading={isEliminando}
        onConfirm={eliminar}
        onCancel={() => setEliminando(null)}
      />
    </div>
  );
}
