import { useCallback, useEffect, useRef, useState } from "react";

import { adjuntosService } from "../../../api/adjuntosService";
import { ConfirmDialog } from "../../common/ConfirmDialog/ConfirmDialog";
import { usePermission } from "../../../hooks/usePermission";
import { descargarBlob } from "../../../utils/descargas";
import { mensajeDeError } from "../../../utils/errores";
import { formatearFecha } from "../../../utils/formato";
import "./AdjuntosPanel.css";

/** Los nueve tipos del §18, en el orden en que suelen aparecer en la vida del equipo. */
const TIPOS = [
  { valor: "factura", etiqueta: "Factura de compra" },
  { valor: "garantia", etiqueta: "Garantía" },
  { valor: "acta_entrega", etiqueta: "Acta de entrega" },
  { valor: "acta_devolucion", etiqueta: "Acta de devolución" },
  { valor: "foto", etiqueta: "Foto del equipo" },
  { valor: "evidencia_dano", etiqueta: "Evidencia de daño" },
  { valor: "cotizacion", etiqueta: "Cotización de reparación" },
  { valor: "informe_tecnico", etiqueta: "Informe técnico" },
  { valor: "documento_baja", etiqueta: "Documento de baja" },
];

const ICONOS = {
  pdf: "file-earmark-pdf",
  jpg: "file-earmark-image",
  jpeg: "file-earmark-image",
  png: "file-earmark-image",
  webp: "file-earmark-image",
  docx: "file-earmark-word",
  xlsx: "file-earmark-excel",
};

const EXTENSIONES = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx";
const MAXIMO_MB = 10;

/**
 * Documentos y evidencias de un activo (§18).
 *
 * La descarga pasa por la API con el token, no por una URL directa al archivo:
 * aquí hay facturas y actas firmadas, y un enlace público bastaría para
 * sacarlas sin pasar por el login.
 */
export function AdjuntosPanel({ activoId, mantenimientoId = null, recargarToken = 0 }) {
  const puedeSubir = usePermission("adjuntos.subir");
  const puedeEliminar = usePermission("adjuntos.eliminar");

  const [adjuntos, setAdjuntos] = useState([]);
  const [error, setError] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [tipo, setTipo] = useState(TIPOS[0].valor);
  const entradaArchivo = useRef(null);

  const cargar = useCallback(() => {
    const params = mantenimientoId
      ? { mantenimiento: mantenimientoId }
      : { activo: activoId, page_size: 100 };
    adjuntosService
      .list(params)
      .then((datos) => setAdjuntos(datos.results ?? datos))
      .catch(() => setError("No se pudieron cargar los adjuntos."));
  }, [activoId, mantenimientoId]);

  // `recargarToken` cambia cuando algo de fuera del panel añade un adjunto
  // —archivar un acta desde el historial, por ejemplo—. Sin él la lista
  // seguiría diciendo «sin documentos» con el documento ya guardado.
  useEffect(() => {
    cargar();
  }, [cargar, recargarToken]);

  async function handleArchivo(event) {
    const archivo = event.target.files?.[0];
    if (!archivo) return;

    setError(null);
    // Se comprueba antes de enviar: subir 20 MB para que el servidor los
    // rechace desperdicia el tiempo de quien está esperando.
    if (archivo.size > MAXIMO_MB * 1024 * 1024) {
      setError(`«${archivo.name}» pesa más de ${MAXIMO_MB} MB.`);
      event.target.value = "";
      return;
    }

    setSubiendo(true);
    try {
      await adjuntosService.subir({
        activo: activoId,
        mantenimiento: mantenimientoId,
        tipo,
        archivo,
      });
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo subir el archivo."));
    } finally {
      setSubiendo(false);
      event.target.value = "";
    }
  }

  async function handleDescargar(adjunto) {
    setError(null);
    try {
      const blob = await adjuntosService.descargar(adjunto.id);
      descargarBlob(blob, adjunto.nombre_original);
    } catch {
      setError("No se pudo descargar el archivo.");
    }
  }

  async function confirmarEliminacion() {
    try {
      await adjuntosService.remove(aEliminar.id);
      setAEliminar(null);
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo eliminar el adjunto."));
      setAEliminar(null);
    }
  }

  return (
    <section className="adjuntos-panel">
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <h3 className="h5 mb-0">Documentos y evidencias</h3>
        {puedeSubir && (
          <div className="d-flex gap-2 align-items-center">
            <select
              className="form-select form-select-sm w-auto"
              aria-label="Tipo de documento"
              value={tipo}
              onChange={(event) => setTipo(event.target.value)}
            >
              {TIPOS.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta}
                </option>
              ))}
            </select>
            <input
              ref={entradaArchivo}
              type="file"
              className="d-none"
              accept={EXTENSIONES}
              onChange={handleArchivo}
            />
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={subiendo}
              onClick={() => entradaArchivo.current?.click()}
            >
              {subiendo ? "Subiendo…" : "Adjuntar archivo"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {adjuntos.length === 0 ? (
        <p className="text-muted mb-0">
          Sin documentos adjuntos.
          {puedeSubir && ` Se admiten PDF, imágenes, Word y Excel de hasta ${MAXIMO_MB} MB.`}
        </p>
      ) : (
        <ul className="list-unstyled adjuntos-lista mb-0">
          {adjuntos.map((adjunto) => (
            <li key={adjunto.id}>
              <i
                className={`bi bi-${ICONOS[extension(adjunto.nombre_original)] || "file-earmark"} adjuntos-lista__icono`}
                aria-hidden="true"
              />
              <div className="adjuntos-lista__datos">
                <button
                  type="button"
                  className="btn btn-link p-0 align-baseline text-start"
                  onClick={() => handleDescargar(adjunto)}
                >
                  {adjunto.nombre_original}
                </button>
                <small className="d-block text-muted">
                  {adjunto.tipo_display} · {formatearTamano(adjunto.tamano_bytes)} ·{" "}
                  {formatearFecha(adjunto.created_at)}
                  {adjunto.generado_por_el_sistema
                    ? " · generado por el sistema"
                    : adjunto.subido_por_nombre && ` · ${adjunto.subido_por_nombre}`}
                </small>
              </div>
              {puedeEliminar && (
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  onClick={() => setAEliminar(adjunto)}
                  aria-label={`Eliminar ${adjunto.nombre_original}`}
                >
                  <i className="bi bi-trash" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={Boolean(aEliminar)}
        title="Eliminar adjunto"
        message={
          aEliminar
            ? `Se eliminará «${aEliminar.nombre_original}» del servidor. La bitácora conservará constancia de que existió, pero el archivo no se podrá recuperar.`
            : ""
        }
        onConfirm={confirmarEliminacion}
        onCancel={() => setAEliminar(null)}
      />
    </section>
  );
}

function extension(nombre = "") {
  return nombre.split(".").pop()?.toLowerCase() ?? "";
}

function formatearTamano(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
