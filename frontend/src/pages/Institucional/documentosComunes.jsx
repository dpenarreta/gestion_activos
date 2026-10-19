import { useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { VisorPdf } from "../../components/common/VisorPdf/VisorPdf";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";

/*
 * Lo que comparten las dos pantallas de los códigos de conducta: la de leer
 * (la que se ve primero) y la de gestionarlos (publicar, editar, borrar).
 */

export const CATEGORIAS = [
  ["conducta", "Código de conducta"],
  ["disciplinario", "Reglamento disciplinario"],
  ["otro", "Otra norma"],
];

export const VACIO = {
  titulo: "",
  categoria: "conducta",
  version: "",
  vigente_desde: "",
  descripcion: "",
  activo: true,
  predeterminado: false,
};

export function tamano(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Publicar o editar un documento, en una ventana. */
export function FormularioDocumento({ inicial, onGuardar, onCerrar }) {
  const [valores, setValores] = useState(inicial);
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const editando = Boolean(inicial.id);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const fijar = (campo) => (e) =>
    setValores((v) => ({
      ...v,
      [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  async function enviar(evento) {
    evento.preventDefault();
    if (!editando && !archivo) {
      setError("Adjunte el documento (PDF o Word).");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const {
        titulo,
        categoria,
        version,
        vigente_desde,
        descripcion,
        activo,
        predeterminado,
      } = valores;
      await onGuardar(
        {
          titulo,
          categoria,
          version,
          vigente_desde,
          descripcion,
          activo,
          predeterminado,
        },
        archivo,
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el documento."));
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
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="documento-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="documento-titulo">
            {editando ? `Editar: ${inicial.titulo}` : "Publicar documento"}
          </h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form className="mz-panel-body row g-2" onSubmit={enviar}>
          {error && (
            <div className="col-12">
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                {error}
              </div>
            </div>
          )}
          <div className="col-12 col-md-8">
            <label className="form-label mz-small" htmlFor="doc-titulo">
              Título
            </label>
            <input
              id="doc-titulo"
              className="form-control form-control-sm"
              required
              maxLength={200}
              value={valores.titulo}
              onChange={fijar("titulo")}
            />
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label mz-small" htmlFor="doc-categoria">
              Tipo
            </label>
            <select
              id="doc-categoria"
              className="form-select form-select-sm"
              value={valores.categoria}
              onChange={fijar("categoria")}
            >
              {CATEGORIAS.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-4">
            <label className="form-label mz-small" htmlFor="doc-version">
              Versión
            </label>
            <input
              id="doc-version"
              className="form-control form-control-sm"
              maxLength={30}
              placeholder="V2"
              value={valores.version}
              onChange={fijar("version")}
            />
          </div>
          <div className="col-6 col-md-4">
            <label className="form-label mz-small" htmlFor="doc-vigente">
              Vigente desde
            </label>
            <input
              id="doc-vigente"
              type="date"
              className="form-control form-control-sm"
              value={valores.vigente_desde ?? ""}
              onChange={fijar("vigente_desde")}
            />
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label mz-small" htmlFor="doc-archivo">
              {editando ? "Reemplazar archivo (opcional)" : "Archivo"}
            </label>
            <input
              id="doc-archivo"
              type="file"
              className="form-control form-control-sm"
              accept=".pdf,.docx"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="col-12">
            <label className="form-label mz-small" htmlFor="doc-descripcion">
              Descripción
            </label>
            <textarea
              id="doc-descripcion"
              className="form-control form-control-sm"
              rows={2}
              value={valores.descripcion}
              onChange={fijar("descripcion")}
            />
          </div>
          <div className="col-12">
            <label className="form-check">
              <input
                type="checkbox"
                className="form-check-input"
                checked={valores.activo}
                onChange={fijar("activo")}
              />{" "}
              <span className="form-check-label">
                Vigente (visible para todos)
              </span>
            </label>
            <label className="form-check">
              <input
                type="checkbox"
                className="form-check-input"
                checked={Boolean(valores.predeterminado)}
                onChange={fijar("predeterminado")}
              />{" "}
              <span className="form-check-label">
                Se abre primero en «Códigos de conducta»
              </span>
            </label>
          </div>
          <p className="col-12 mz-faint mb-0">
            PDF (se lee en el visor del sistema) o Word, hasta 20 MB.
          </p>
          <div className="col-12 mz-actions justify-content-end">
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
              disabled={guardando}
            >
              {guardando
                ? "Guardando…"
                : editando
                  ? "Guardar cambios"
                  : "Publicar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Abrir un documento: un PDF en el visor del sistema; un Word se descarga
 * (el navegador no lo muestra). Devuelve `abrir`, cuál se está abriendo, el
 * error si lo hubo y el visor, para dibujarlo donde convenga.
 */
export function useAbrirDocumento() {
  const [abierto, setAbierto] = useState(null);
  const [abriendo, setAbriendo] = useState(null);
  const [error, setError] = useState(null);

  async function abrir(documento) {
    setError(null);
    setAbriendo(documento.id);
    try {
      const blob = await institucionalService.archivoDocumento(documento.id);
      if (documento.es_pdf) {
        setAbierto({ documento, blob });
      } else {
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement("a");
        enlace.href = url;
        enlace.download = documento.nombre_original;
        enlace.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo abrir el documento."));
    } finally {
      setAbriendo(null);
    }
  }

  const visor = abierto ? (
    <VisorPdf
      titulo={abierto.documento.titulo}
      blob={abierto.blob}
      nombreArchivo={abierto.documento.nombre_original}
      onCerrar={() => setAbierto(null)}
    />
  ) : null;

  return { abrir, abriendo, error, visor };
}

/**
 * El acuerdo de confidencialidad, en una ventana: se acepta para ver los
 * documentos. «Ahora no» la cierra, pero sin aceptar no se ve el contenido.
 */
export function VentanaAcuerdo({ acuerdo, onAceptar, onCerrar }) {
  const [aceptando, setAceptando] = useState(false);
  const [error, setError] = useState(null);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });

  async function aceptar() {
    setAceptando(true);
    setError(null);
    try {
      await onAceptar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo registrar la aceptación."));
      setAceptando(false);
    }
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acuerdo-titulo"
        aria-describedby="acuerdo-texto"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="acuerdo-titulo">
            <Icon name="shield-lock" /> {acuerdo.titulo}
          </h3>
        </div>
        <div className="mz-panel-body">
          {acuerdo.aceptado_antes_en && (
            <div className="mz-alert mz-alert--warn" role="status">
              <Icon name="info-circle" />
              Los documentos cambiaron desde que aceptó el acuerdo: acéptelo de
              nuevo para verlos.
            </div>
          )}
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <div id="acuerdo-texto" className="acuerdo-texto">
            {acuerdo.texto}
          </div>
          <div className="mz-actions justify-content-end mt-3">
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
              onClick={aceptar}
              disabled={aceptando}
            >
              {aceptando ? "Registrando…" : "Acepto el acuerdo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
