/*
 * Los documentos de un proyecto (`ProjectDocumentsTab` de Nexo). Subir:
 * quien participa, como archivo (multipart), no en base64. El servidor valida
 * el tamaño, la extensión y la firma del contenido y dice el motivo cuando no
 * lo admite (`details.file`): ese mensaje se muestra tal cual. Según el campo
 * `viewer` del servidor, el PDF se abre en el visor de PDF y la presentación
 * .pptx en el de diapositivas (`useVisorDeAdjuntos`, que la pide como blob);
 * con `viewer: null` (Word, Excel, el .ppt antiguo) se descarga.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import { Campo } from "../../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { seVeAdentro, useVisorDeAdjuntos } from "../../Soporte/VisorAdjunto";
import { ErrorEnLinea, fechaHora } from "../comunes";
import {
  CATEGORIA_DOCUMENTO,
  CATEGORIAS_DOCUMENTO,
  TIPOS_DE_DOCUMENTO,
  nombreDe,
  tamano,
} from "./proyectosComunes";

export function Documentos({ proyecto, onSubido }) {
  const [documentos, setDocumentos] = useState(null);
  const [error, setError] = useState(null);
  const { abrir, abriendo, visor, error: errorVisor } = useVisorDeAdjuntos();

  const cargar = useCallback(() => {
    setError(null);
    proyectosGhService
      .documentos(proyecto.id)
      .then((lista) => setDocumentos(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeProyectos(err, "No se pudieron cargar los documentos.")
            .mensaje,
        ),
      );
  }, [proyecto.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="mz-stack">
      <h3 className="gp-subtitulo">Documentos</h3>
      {proyecto.can_participate && (
        <Subir
          proyectoId={proyecto.id}
          onSubido={(doc) => {
            setDocumentos((lista) => [doc, ...(lista ?? [])]);
            onSubido?.(doc);
          }}
        />
      )}
      <ErrorEnLinea mensaje={errorVisor} />
      <EstadoDeCarga
        cargando={documentos === null && !error}
        error={error}
        onReintentar={cargar}
        vacio={documentos?.length === 0}
        textoVacio={
          proyecto.can_participate
            ? "Todavía no hay documentos. Suba el primero con el formulario."
            : "Todavía no hay documentos."
        }
      />
      {documentos?.length > 0 && (
        <ul className="gp-lista">
          {documentos.map((d) => {
            // `viewer` lo decide el servidor: "pdf" y "presentacion" (.pptx)
            // se ven dentro del sistema; `null` (Word, Excel, .ppt) se descarga.
            const adentro =
              d.viewer !== undefined
                ? d.viewer !== null
                : seVeAdentro(d.file_name);
            return (
              <li key={d.id} className="gp-documento">
                <Icon
                  name={adentro ? "file-earmark-richtext" : "file-earmark"}
                  className="gp-documento__icono"
                />
                <div className="gt-min0 flex-grow-1">
                  <p className="mz-strong gp-partir mb-0">
                    {d.file_name}
                    {d.version > 1 && (
                      <span className="mz-pill mz-pill--neutral ms-2">
                        v{d.version}
                      </span>
                    )}
                  </p>
                  <p className="mz-small mz-faint mb-0">
                    {[
                      CATEGORIA_DOCUMENTO[d.category] ?? d.category,
                      nombreDe(d.uploaded_by),
                      fechaHora(d.created_at),
                      d.file_size ? tamano(d.file_size) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  disabled={abriendo === d.id}
                  onClick={() =>
                    abrir({ id: d.id, url: d.file_url, nombre: d.file_name })
                  }
                >
                  <Icon name={adentro ? "eye" : "download"} />{" "}
                  {abriendo === d.id
                    ? "Abriendo…"
                    : adentro
                      ? "Ver"
                      : "Descargar"}
                  <span className="visually-hidden"> «{d.file_name}»</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {visor}
    </div>
  );
}

function Subir({ proyectoId, onSubido }) {
  const [categoria, setCategoria] = useState("OTRO");
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const enCurso = useRef(false);
  const entrada = useRef(null);

  async function enviar(evento) {
    evento.preventDefault();
    if (!archivo || enCurso.current) return;
    enCurso.current = true;
    setSubiendo(true);
    setError(null);
    setMensaje(null);
    try {
      const doc = await proyectosGhService.subirDocumento(proyectoId, archivo, {
        categoria,
      });
      onSubido(doc);
      setArchivo(null);
      if (entrada.current) entrada.current.value = "";
      setMensaje(`«${doc.file_name}» se subió.`);
    } catch (err) {
      // El motivo exacto (tipo no admitido, tamaño, contenido que no
      // corresponde) lo da el servidor.
      setError(errorDeProyectos(err, "No se pudo subir el documento.").mensaje);
    } finally {
      enCurso.current = false;
      setSubiendo(false);
    }
  }

  return (
    <form className="gh-recuadro gp-subir" onSubmit={enviar}>
      <p role="status" className="visually-hidden">
        {mensaje}
      </p>
      {mensaje && (
        <div className="mz-alert mz-alert--ok" aria-hidden="true">
          <Icon name="check2-circle" />
          <span>{mensaje}</span>
        </div>
      )}
      <div className="gp-subir__campos">
        <Campo id="gp-doc-categoria" etiqueta="Categoría">
          <select
            className="form-select"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            {CATEGORIAS_DOCUMENTO.map((c) => (
              <option key={c} value={c}>
                {CATEGORIA_DOCUMENTO[c]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo
          id="gp-doc-archivo"
          etiqueta="Archivo"
          ayuda={TIPOS_DE_DOCUMENTO.ayuda}
          error={error}
          className="flex-grow-1"
        >
          <input
            ref={entrada}
            type="file"
            className="form-control"
            accept={TIPOS_DE_DOCUMENTO.accept}
            onChange={(e) => {
              setArchivo(e.target.files?.[0] ?? null);
              setError(null);
            }}
          />
        </Campo>
      </div>
      <div className="mz-actions justify-content-end">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!archivo || subiendo}
        >
          <Icon name="upload" /> {subiendo ? "Subiendo…" : "Subir documento"}
        </button>
      </div>
    </form>
  );
}
