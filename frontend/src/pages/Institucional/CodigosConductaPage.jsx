import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import {
  MarcoPdf,
  useUrlDePdf,
} from "../../components/common/VisorPdf/VisorPdf";
import { useAuth } from "../../hooks/useAuth";
import { useModalA11y } from "../../hooks/useModalA11y";
import { PERMISOS_CODIGOS } from "../../modulos/permisosInstitucional";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import { CATEGORIAS, VentanaAcuerdo, tamano } from "./documentosComunes";
import "./Institucional.css";
import { descargarBlob } from "../../utils/descargas";

const NOMBRE_CATEGORIA = Object.fromEntries(CATEGORIAS);

/** Primero el marcado como predeterminado; si ninguno, el primero. */
function elegidoPorDefecto(documentos) {
  return (documentos.find((d) => d.predeterminado) ?? documentos[0])?.id;
}

/** Lo que muestra la pestaña de un documento: sus datos y, si es PDF, el
 * documento mismo; un Word no se puede mostrar y se ofrece descargar. */
function PanelDelDocumento({
  documento,
  blob,
  error,
  bloqueado,
  errorAcuerdo,
  onReintentarAcuerdo,
  onVerAcuerdo,
}) {
  const url = useUrlDePdf(documento.es_pdf ? blob : null);
  const urlDescarga = useUrlDePdf(blob);

  return (
    <div className="docs-panel">
      <div className="docs-panel__cabecera">
        <div>
          <strong>{documento.titulo}</strong>
          <small>
            {[
              NOMBRE_CATEGORIA[documento.categoria],
              documento.version && `Versión ${documento.version}`,
              documento.vigente_desde &&
                `vigente desde ${formatearFecha(documento.vigente_desde)}`,
              tamano(documento.tamano_bytes),
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
          {documento.descripcion && <p>{documento.descripcion}</p>}
        </div>
        {!bloqueado && urlDescarga && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => descargarBlob(blob, documento.nombre_original)}
          >
            <Icon name="download" /> Descargar
          </button>
        )}
      </div>
      <div className="docs-panel__cuerpo">
        {bloqueado && errorAcuerdo ? (
          <EstadoDeCarga
            error={errorAcuerdo}
            onReintentar={onReintentarAcuerdo}
          />
        ) : bloqueado ? (
          <div className="mz-empty">
            <Icon name="shield-lock" />
            <p>
              Para ver el contenido de los documentos, acepte el acuerdo de
              confidencialidad.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onVerAcuerdo}
            >
              Leer y aceptar el acuerdo
            </button>
          </div>
        ) : error ? (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        ) : documento.es_pdf ? (
          <MarcoPdf titulo={documento.titulo} url={url} />
        ) : (
          <div className="mz-empty">
            <Icon name="file-earmark-word" />
            <p>
              Este documento es un archivo de Word y no se puede mostrar en el
              navegador. Descárguelo para leerlo.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Lo que la persona aceptó, tal cual, para volver a leerlo (auditoría
 * UX/UI, 30/10/2026). */
function VentanaAceptado({ acuerdo, onCerrar }) {
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
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aceptado-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="aceptado-titulo">
            <Icon name="shield-check" />{" "}
            {acuerdo.titulo_aceptado || acuerdo.titulo}
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
        <div className="mz-panel-body">
          <p className="mz-faint mz-small">
            Lo aceptó el {formatearFecha(acuerdo.aceptado_en, true)}
          </p>
          <div className="acuerdo-texto" data-autofocus tabIndex={-1}>
            {acuerdo.texto_aceptado || acuerdo.texto}
          </div>
          <div className="mz-actions justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Institucional → Códigos de conducta: la pantalla que se ve primero, solo
 * para leer. Cada documento vigente es una pestaña; abre la del marcado como
 * predeterminado (o la primera) y el documento se lee ahí mismo. Si un
 * documento se borra o se retira, su pestaña desaparece. Quien tiene
 * algún permiso de `codigos.*` ve además «Gestionar documentos».
 */
export function CodigosConductaPage() {
  const { user } = useAuth();
  // Con cualquiera de los permisos de la gestión se ve el botón; dentro,
  // cada pestaña pide el suyo.
  const gestiona = PERMISOS_CODIGOS.some((p) => user?.permissions?.includes(p));
  const [documentos, setDocumentos] = useState(null);
  const [activo, setActivo] = useState(null);
  const [archivos, setArchivos] = useState({});
  const [errores, setErrores] = useState({});
  const [errorDocumentos, setErrorDocumentos] = useState(null);
  const [errorAcuerdo, setErrorAcuerdo] = useState(null);
  const [acuerdo, setAcuerdo] = useState(null);
  const [verAcuerdo, setVerAcuerdo] = useState(false);
  const [verAceptado, setVerAceptado] = useState(false);
  const pedidos = useRef(new Set());
  const aceptado = Boolean(acuerdo?.aceptado);

  // Al entrar: si no tiene aceptado el acuerdo vigente, se le presenta.
  const cargarAcuerdo = useCallback(() => {
    setErrorAcuerdo(null);
    institucionalService
      .confidencialidad()
      .then((estado) => {
        setAcuerdo(estado);
        setVerAcuerdo(!estado.aceptado);
      })
      .catch((err) =>
        setErrorAcuerdo(mensajeDeError(err, "No se pudo cargar el acuerdo.")),
      );
  }, []);

  useEffect(() => {
    cargarAcuerdo();
  }, [cargarAcuerdo]);

  async function aceptar() {
    setAcuerdo(await institucionalService.aceptarConfidencialidad());
    setVerAcuerdo(false);
  }

  const cargarDocumentos = useCallback(() => {
    setErrorDocumentos(null);
    institucionalService
      .documentos()
      // Solo los vigentes, también para quien gestiona: es lo que lee el
      // resto. Los retirados se ven en la gestión.
      .then((lista) => {
        const vigentes = lista.filter((d) => d.activo);
        setDocumentos(vigentes);
        setActivo(elegidoPorDefecto(vigentes) ?? null);
      })
      .catch((err) =>
        setErrorDocumentos(
          mensajeDeError(err, "No se pudieron cargar los documentos."),
        ),
      );
  }, []);

  useEffect(() => {
    cargarDocumentos();
  }, [cargarDocumentos]);

  // El archivo de la pestaña abierta se trae una vez y queda en memoria:
  // volver a una pestaña ya vista no lo pide de nuevo.
  // Sin el acuerdo aceptado no se pide ningún archivo (el servidor tampoco
  // lo entregaría).
  useEffect(() => {
    if (!aceptado || !activo || pedidos.current.has(activo)) return;
    pedidos.current.add(activo);
    institucionalService
      .archivoDocumento(activo)
      .then((blob) => setArchivos((a) => ({ ...a, [activo]: blob })))
      .catch((err) => {
        // Si los documentos cambiaron mientras tanto, se vuelve a pedir el
        // acuerdo en vez de mostrar un error.
        if (err?.response?.data?.error?.code === "acuerdo_pendiente") {
          pedidos.current.delete(activo);
          institucionalService
            .confidencialidad()
            .then((estado) => {
              setAcuerdo(estado);
              setVerAcuerdo(true);
            })
            .catch((e) =>
              setErrorAcuerdo(
                mensajeDeError(e, "No se pudo cargar el acuerdo."),
              ),
            );
          return;
        }
        setErrores((e) => ({
          ...e,
          [activo]: mensajeDeError(err, "No se pudo abrir el documento."),
        }));
      });
  }, [activo, aceptado]);

  const elegido = documentos?.find((d) => d.id === activo);

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Códigos de conducta</h2>
          <p className="mz-desc">
            Los códigos de conducta, reglamentos disciplinarios y demás normas
            de la empresa.
            {aceptado && acuerdo.aceptado_en && (
              <>
                {" "}
                <span className="mz-faint">
                  <Icon name="shield-check" /> Aceptó el acuerdo de
                  confidencialidad el{" "}
                  {formatearFecha(acuerdo.aceptado_en, true)} ·{" "}
                  <button
                    type="button"
                    className="btn btn-link p-0 align-baseline enlace-en-texto"
                    onClick={() => setVerAceptado(true)}
                  >
                    Ver lo que acepté
                  </button>
                </span>
              </>
            )}
          </p>
        </div>
        {gestiona && (
          <div className="mz-actions">
            <Link
              to="/admin/institucional/codigos/gestionar"
              className="btn btn-outline-primary btn-sm"
            >
              <Icon name="gear" /> Gestionar documentos
            </Link>
          </div>
        )}
      </div>

      {/* Cargando, error con «Reintentar» y vacío (antes no se veía nada
          mientras cargaba). */}
      {(documentos === null || documentos.length === 0) && (
        <div className="mz-card">
          <div className="mz-card-body">
            <EstadoDeCarga
              cargando={documentos === null && !errorDocumentos}
              error={errorDocumentos}
              onReintentar={cargarDocumentos}
              vacio={documentos?.length === 0}
              textoVacio="Todavía no hay documentos publicados."
            />
          </div>
        </div>
      )}

      {documentos?.length > 0 && (
        <>
          {/* Pestañas comunes: flechas, Inicio/Fin y una sola parada de Tab
              (revisión final UX/UI, 28/10/2026). */}
          <Pestanas
            etiqueta="Documentos"
            idBase="doc"
            valor={activo}
            onCambio={setActivo}
            className="docs-pestanas"
            opciones={documentos.map((d) => ({
              id: d.id,
              etiqueta: d.titulo,
              icono: d.es_pdf ? "file-earmark-pdf" : "file-earmark-word",
            }))}
          />
          {elegido && (
            <PanelDePestana idBase="doc" valor={elegido.id}>
              <PanelDelDocumento
                key={elegido.id}
                documento={elegido}
                blob={archivos[elegido.id]}
                error={errores[elegido.id]}
                bloqueado={!aceptado}
                errorAcuerdo={errorAcuerdo}
                onReintentarAcuerdo={cargarAcuerdo}
                onVerAcuerdo={() => setVerAcuerdo(true)}
              />
            </PanelDePestana>
          )}
        </>
      )}

      {verAceptado && acuerdo && (
        <VentanaAceptado
          acuerdo={acuerdo}
          onCerrar={() => setVerAceptado(false)}
        />
      )}
      {acuerdo && verAcuerdo && !aceptado && (
        <VentanaAcuerdo
          acuerdo={acuerdo}
          onAceptar={aceptar}
          onCerrar={() => setVerAcuerdo(false)}
        />
      )}
    </div>
  );
}
