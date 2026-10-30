import { useRef, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { Icon } from "../../components/common/Icon/Icon";
import { VisorPdf } from "../../components/common/VisorPdf/VisorPdf";
import { useModalA11y } from "../../hooks/useModalA11y";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import { descargarBlob } from "../../utils/descargas";
import { confirmar } from "../../components/common/Confirmar/confirmar";

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

/** Los PDF de hasta 20 MB (los nuevos documentos, solo en PDF: se leen en
 * el visor del sistema en cualquier equipo). */
const MAXIMO = 20 * 1024 * 1024;

/** Publicar o editar un documento, en una ventana (auditoría UX/UI,
 * 30/10/2026: obligatorios marcados, errores junto a su campo, el archivo
 * actual a la vista y el aviso de cuándo se pide aceptar de nuevo). */
export function FormularioDocumento({ inicial, onGuardar, onCerrar }) {
  const [valores, setValores] = useState(inicial);
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const formulario = useRef(null);
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
  // Publicar uno vigente, reemplazar su archivo o volver a publicarlo pide a
  // todos aceptar de nuevo el acuerdo; el resto de los cambios, no.
  const pideAceptar =
    valores.activo &&
    (!editando || Boolean(archivo) || (editando && !inicial.activo));
  const accionQuePide =
    archivo && editando
      ? {
          titulo: "Reemplazar el archivo",
          boton: "Reemplazar",
          aviso: "Al reemplazar el archivo",
        }
      : editando
        ? {
            titulo: "Volver a publicar el documento",
            boton: "Volver a publicar",
            aviso: "Al volver a publicarlo",
          }
        : {
            titulo: "Publicar el documento",
            boton: "Publicar",
            aviso: "Al publicarlo",
          };

  async function enviar(evento) {
    evento.preventDefault();
    const propios = {};
    if (!valores.titulo.trim()) propios.titulo = "Escriba el título.";
    if (!editando && !archivo) propios.archivo = "Adjunte el documento en PDF.";
    if (archivo && !/\.pdf$/i.test(archivo.name))
      propios.archivo =
        "Suba el documento en PDF: en Word, «Archivo › Guardar como» y elija PDF.";
    else if (archivo && archivo.size > MAXIMO)
      propios.archivo = "El archivo pasa de 20 MB.";
    setErrores(propios);
    setError(null);
    if (Object.keys(propios).length) {
      enfocarPrimerError(formulario.current);
      return;
    }
    // Si obliga a todos a aceptar de nuevo, se confirma (además del aviso),
    // con el nombre de lo que se hace; retirarlo desde aquí también se
    // confirma, como el botón «Retirar» de la tabla.
    const retira = editando && inicial.activo && !valores.activo;
    if (
      (pideAceptar || retira) &&
      !(await confirmar(
        retira
          ? {
              titulo: `¿Retirar «${inicial.titulo}»?`,
              mensaje:
                "Deja de verse en «Códigos de conducta». Puede volver a publicarlo cuando quiera.",
              accion: "Retirar",
              peligro: false,
            }
          : {
              titulo: `¿${accionQuePide.titulo}?`,
              mensaje:
                "Todas las personas deberán aceptar de nuevo el acuerdo de confidencialidad para leer los documentos.",
              accion: accionQuePide.boton,
              peligro: false,
            },
      ))
    )
      return;
    setGuardando(true);
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
      const delServidor = erroresPorCampo(err);
      setErrores(delServidor);
      setError(
        Object.keys(delServidor).length
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudo guardar el documento."),
      );
      setGuardando(false);
      enfocarPrimerError(formulario.current);
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
        {/* La fila va dentro del cuerpo: sus márgenes negativos ya no
            desbordan la ventana (había desplazamiento horizontal). */}
        <form
          ref={formulario}
          className="mz-panel-body"
          onSubmit={enviar}
          noValidate
        >
          <div className="row g-2">
            {error && (
              <div className="col-12">
                <div className="mz-alert mz-alert--bad" role="alert">
                  <Icon name="x-octagon" />
                  {error}
                </div>
              </div>
            )}
            <div className="col-12">
              <LeyendaObligatorios />
            </div>
            <Campo
              id="doc-titulo"
              etiqueta="Título"
              obligatorio
              error={errores.titulo}
              className="col-12 col-md-8"
            >
              <input
                className="form-control form-control-sm"
                maxLength={200}
                value={valores.titulo}
                onChange={fijar("titulo")}
                data-autofocus
              />
            </Campo>
            <Campo
              id="doc-categoria"
              etiqueta="Tipo"
              error={errores.categoria}
              className="col-12 col-md-4"
            >
              <select
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
            </Campo>
            <Campo
              id="doc-version"
              etiqueta="Versión"
              error={errores.version}
              className="col-6 col-md-4"
            >
              <input
                className="form-control form-control-sm"
                maxLength={30}
                placeholder="Ej.: V2"
                value={valores.version}
                onChange={fijar("version")}
              />
            </Campo>
            <Campo
              id="doc-vigente"
              etiqueta="Vigente desde"
              error={errores.vigente_desde}
              className="col-6 col-md-4"
            >
              <input
                type="date"
                className="form-control form-control-sm"
                value={valores.vigente_desde ?? ""}
                onChange={fijar("vigente_desde")}
              />
            </Campo>
            <Campo
              id="doc-archivo"
              etiqueta={
                editando ? "Reemplazar el archivo (opcional)" : "Archivo"
              }
              obligatorio={!editando}
              ayuda={
                editando && inicial.nombre_original
                  ? `Archivo actual: ${inicial.nombre_original} · ${tamano(inicial.tamano_bytes)}. Solo PDF, hasta 20 MB.`
                  : "Solo PDF (se lee en el visor del sistema), hasta 20 MB."
              }
              error={errores.archivo}
              className="col-12 col-md-4"
            >
              <input
                type="file"
                className="form-control form-control-sm"
                accept=".pdf,application/pdf"
                onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              />
            </Campo>
            <Campo
              id="doc-descripcion"
              etiqueta="Descripción"
              error={errores.descripcion}
              className="col-12"
            >
              <textarea
                className="form-control form-control-sm"
                rows={2}
                value={valores.descripcion}
                onChange={fijar("descripcion")}
              />
            </Campo>
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
            {pideAceptar && (
              <div className="col-12">
                <div className="mz-alert mz-alert--warn mb-0" role="note">
                  <Icon name="exclamation-triangle" />
                  <span>
                    {accionQuePide.aviso}, todas las personas deberán aceptar de
                    nuevo el acuerdo de confidencialidad para leer los
                    documentos.
                  </span>
                </div>
              </div>
            )}
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
        descargarBlob(blob, documento.nombre_original);
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
