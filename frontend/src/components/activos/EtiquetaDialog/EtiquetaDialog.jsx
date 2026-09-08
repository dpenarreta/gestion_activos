import { useCallback, useEffect, useState } from "react";

import { activosService } from "../../../api/activosService";
import { ModalDialog } from "../../common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../../utils/errores";
import "./EtiquetaDialog.css";

const FORMATOS = [
  { valor: "zpl", etiqueta: "ZPL — Zebra y compatibles" },
  { valor: "tspl", etiqueta: "TSPL — TSC, Godex y compatibles" },
];

const EXTENSIONES = { zpl: "zpl", tspl: "txt" };

/**
 * Generación del trabajo de impresión térmica de una etiqueta (RF-08).
 *
 * El servidor no envía nada a la impresora: produce el texto del trabajo y
 * aquí se descarga como archivo para que el operador lo mande a su cola
 * (`lpr`, `copy /b` a un puerto, o el utilitario del fabricante). Se muestra
 * también el contenido en crudo porque, al configurar una impresora nueva,
 * poder ver los comandos exactos es la diferencia entre diagnosticar un
 * problema de márgenes en un minuto o a ciegas.
 */
export function EtiquetaDialog({ activo, onCerrar }) {
  const [formato, setFormato] = useState("zpl");
  const [contenido, setContenido] = useState("");
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(() => {
    setIsLoading(true);
    setError(null);
    activosService
      .etiqueta(activo.id, formato)
      .then((datos) => setContenido(datos.contenido))
      .catch((err) => setError(mensajeDeError(err, "No se pudo generar la etiqueta.")))
      .finally(() => setIsLoading(false));
  }, [activo.id, formato]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function handleDescargar() {
    try {
      const blob = await activosService.descargarEtiqueta(activo.id, formato);
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = `etiqueta-${activo.codigo_barras}.${EXTENSIONES[formato]}`;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      // Liberar el object URL: sin esto el blob queda retenido en memoria
      // mientras viva la pestaña.
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar la etiqueta."));
    }
  }

  async function handleCopiar() {
    try {
      await navigator.clipboard.writeText(contenido);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // El portapapeles puede estar bloqueado (contexto no seguro, permiso
      // denegado). El contenido sigue visible y seleccionable a mano.
      setError("El navegador bloqueó el acceso al portapapeles. Copie el texto manualmente.");
    }
  }

  return (
    <ModalDialog
      titulo="Etiqueta térmica"
      subtitulo={`${activo.codigo_barras} · ${activo.nombre}`}
      onCerrar={onCerrar}
      anchoMaximo="44rem"
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="mb-3">
        <label className="form-label" htmlFor="formato-etiqueta">
          Lenguaje de la impresora
        </label>
        <select
          id="formato-etiqueta"
          className="form-select"
          value={formato}
          onChange={(event) => setFormato(event.target.value)}
        >
          {FORMATOS.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </select>
        <div className="form-text">
          Etiqueta de 50 × 25 mm a 203 dpi, con el código en Code 128.
        </div>
      </div>

      <div className="etiqueta-previa mb-3" aria-label="Vista previa de la etiqueta">
        <div className="etiqueta-previa__nombre">{activo.nombre}</div>
        <div className="etiqueta-previa__area">{activo.departamento_nombre}</div>
        <div className="etiqueta-previa__barras" aria-hidden="true" />
        <div className="etiqueta-previa__codigo">{activo.codigo_barras}</div>
      </div>

      <label className="form-label" htmlFor="contenido-etiqueta">
        Trabajo de impresión
      </label>
      <textarea
        id="contenido-etiqueta"
        className="form-control font-monospace etiqueta-contenido"
        rows={9}
        readOnly
        value={isLoading ? "Generando…" : contenido}
      />

      <div className="d-flex gap-2 mt-3">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleDescargar}
          disabled={isLoading || !contenido}
        >
          <i className="bi bi-download me-1" aria-hidden="true" />
          Descargar archivo
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={handleCopiar}
          disabled={isLoading || !contenido}
        >
          {copiado ? "Copiado" : "Copiar al portapapeles"}
        </button>
      </div>
    </ModalDialog>
  );
}
