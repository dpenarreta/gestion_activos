import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import { FilaDeEstado } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useAuth } from "../../hooks/useAuth";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import {
  AceptacionesConfidencialidad,
  AcuerdoConfidencialidad,
} from "./ConfidencialidadGestion";
import {
  CATEGORIAS,
  FormularioDocumento,
  VACIO,
  tamano,
  useAbrirDocumento,
} from "./documentosComunes";
import "./Institucional.css";
import { confirmar } from "../../components/common/Confirmar/confirmar";

const NOMBRE_CATEGORIA = Object.fromEntries(CATEGORIAS);

/** Cada pestaña con el permiso que la abre. */
const PESTANAS = [
  ["documentos", "Documentos", "codigos.publicar"],
  ["acuerdo", "Acuerdo de confidencialidad", "codigos.acuerdo"],
  ["aceptaciones", "Aceptaciones", "codigos.ver_aceptaciones"],
];

/**
 * Códigos de conducta → Gestionar documentos (pide
 * algún permiso de `codigos.*`, y cada pestaña el suyo): todos los documentos
 * cargados, también los
 * retirados, para publicar uno nuevo, editarlo, reemplazar su archivo,
 * retirarlo o borrarlo; el acuerdo de confidencialidad y quién lo aceptó. Se
 * llega desde el botón de la pantalla de lectura.
 */
export function GestionDocumentosPage() {
  const [documentos, setDocumentos] = useState(null);
  const [error, setError] = useState(null);
  // El fallo al cargar va en la tabla, con «Reintentar» (auditoría UX/UI,
  // fase 2, 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [editando, setEditando] = useState(null);
  const { user } = useAuth();
  const visibles = PESTANAS.filter(([, , permiso]) =>
    user?.permissions?.includes(permiso),
  );
  const [pestana, setPestana] = useState(visibles[0]?.[0] ?? "documentos");
  const documento = useAbrirDocumento();

  const cargar = useCallback(() => {
    setErrorCarga(null);
    return institucionalService
      .documentos()
      .then(setDocumentos)
      .catch((err) =>
        setErrorCarga(
          mensajeDeError(err, "No se pudieron cargar los documentos."),
        ),
      );
  }, []);

  // Los documentos se piden solo si se van a mostrar (quien solo ve las
  // aceptaciones no los necesita).
  const publica = visibles.some(([id]) => id === "documentos");
  useEffect(() => {
    if (publica) cargar();
  }, [cargar, publica]);

  async function guardar(campos, archivo) {
    await institucionalService.guardarDocumento(editando.id, campos, archivo);
    setAviso(editando.id ? "Documento actualizado." : "Documento publicado.");
    setEditando(null);
    await cargar();
  }

  async function ejecutar(accion, mensaje) {
    setError(null);
    setAviso(null);
    try {
      await accion();
      setAviso(mensaje);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  const fallo = error || documento.error;

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Gestionar documentos</h2>
          <p className="mz-desc">
            Los códigos de conducta y reglamentos cargados. Los vigentes los ve
            toda persona en «Códigos de conducta»; los retirados, solo aquí.
          </p>
        </div>
        <div className="mz-actions">
          <Link
            to="/admin/institucional/codigos"
            className="btn btn-outline-secondary btn-sm"
          >
            <Icon name="arrow-left" /> Volver a los documentos
          </Link>
          {pestana === "documentos" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setEditando({ ...VACIO })}
            >
              <Icon name="plus-lg" /> Publicar documento
            </button>
          )}
        </div>
      </div>

      {/* Pestañas con flechas y su panel (auditoría UX/UI, fase 2,
          28/10/2026). */}
      <Pestanas
        etiqueta="Gestión"
        idBase="gdoc"
        valor={pestana}
        onCambio={setPestana}
        opciones={visibles.map(([id, etiqueta]) => ({ id, etiqueta }))}
      />

      <PanelDePestana idBase="gdoc" valor={pestana} className="mz-stack">
        {pestana === "acuerdo" && <AcuerdoConfidencialidad />}
        {pestana === "aceptaciones" && <AceptacionesConfidencialidad />}
        {pestana === "documentos" && (
          <>
            {fallo && (
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                {fallo}
              </div>
            )}
            {aviso && (
              <div className="mz-alert mz-alert--ok" role="status">
                <Icon name="check-circle" />
                {aviso}
              </div>
            )}

            <div className="mz-table-wrap">
              <table className="mz-table">
                <thead>
                  <tr>
                    <th>Documento</th>
                    <th>Tipo</th>
                    <th>Versión</th>
                    <th>Vigente desde</th>
                    <th>Archivo</th>
                    <th>Estado</th>
                    <th>Se abre primero</th>
                    <th>Publicado por</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {(documentos ?? []).map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.titulo}</strong>
                        {d.descripcion && (
                          <span className="d-block mz-small mz-faint">
                            {d.descripcion}
                          </span>
                        )}
                      </td>
                      <td>{NOMBRE_CATEGORIA[d.categoria]}</td>
                      <td>{d.version || "—"}</td>
                      <td>{formatearFecha(d.vigente_desde)}</td>
                      <td className="mz-small">
                        <Icon
                          name={
                            d.es_pdf ? "file-earmark-pdf" : "file-earmark-word"
                          }
                        />{" "}
                        {d.nombre_original} · {tamano(d.tamano_bytes)}
                      </td>
                      <td>
                        <span
                          className={`mz-pill ${d.activo ? "mz-pill--ok" : "mz-pill--neutral"}`}
                        >
                          {d.activo ? "Vigente" : "Retirado"}
                        </span>
                      </td>
                      <td>
                        {/* Uno solo: marcar este desmarca al anterior. */}
                        <button
                          type="button"
                          className={`btn btn-sm ${d.predeterminado ? "btn-warning" : "btn-outline-secondary"}`}
                          aria-pressed={d.predeterminado}
                          aria-label={
                            d.predeterminado
                              ? `${d.titulo} se abre primero`
                              : `Abrir primero ${d.titulo}`
                          }
                          title={
                            d.predeterminado
                              ? "Es el que se abre primero. Pulse para quitarlo."
                              : "Que se abra primero en «Códigos de conducta»"
                          }
                          onClick={() =>
                            ejecutar(
                              () =>
                                institucionalService.guardarDocumento(d.id, {
                                  predeterminado: !d.predeterminado,
                                }),
                              d.predeterminado
                                ? `«${d.titulo}» ya no se abre primero.`
                                : `«${d.titulo}» se abrirá primero.`,
                            )
                          }
                        >
                          <Icon
                            name={d.predeterminado ? "star-fill" : "star"}
                          />
                        </button>
                      </td>
                      <td className="mz-small">
                        {d.subido_por_nombre || "—"}
                        <span className="d-block mz-faint">
                          {formatearFecha(d.created_at)}
                        </span>
                      </td>
                      <td className="num text-nowrap">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          aria-label={`${d.es_pdf ? "Ver" : "Descargar"} ${d.titulo}`}
                          disabled={documento.abriendo === d.id}
                          onClick={() => documento.abrir(d)}
                        >
                          <Icon name={d.es_pdf ? "eye" : "download"} />
                        </button>{" "}
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          aria-label={`Editar ${d.titulo}`}
                          onClick={() => setEditando({ ...VACIO, ...d })}
                        >
                          <Icon name="pencil" />
                        </button>{" "}
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          aria-label={`${d.activo ? "Retirar" : "Volver a publicar"} ${d.titulo}`}
                          title={d.activo ? "Retirar" : "Volver a publicar"}
                          onClick={() =>
                            ejecutar(
                              () =>
                                institucionalService.guardarDocumento(d.id, {
                                  activo: !d.activo,
                                }),
                              d.activo
                                ? `«${d.titulo}» se retiró: ya no lo ven los demás.`
                                : `«${d.titulo}» vuelve a estar vigente.`,
                            )
                          }
                        >
                          <Icon
                            name={
                              d.activo ? "eye-slash" : "arrow-counterclockwise"
                            }
                          />
                        </button>{" "}
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          aria-label={`Borrar ${d.titulo}`}
                          onClick={async () => {
                            const si = await confirmar({
                              titulo: `¿Borrar el documento «${d.titulo}»?`,
                              accion: "Borrar",
                            });
                            if (si) {
                              ejecutar(
                                () =>
                                  institucionalService.eliminarDocumento(d.id),
                                `«${d.titulo}» se borró.`,
                              );
                            }
                          }}
                        >
                          <Icon name="trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <FilaDeEstado
                    columnas={9}
                    cargando={documentos === null}
                    error={errorCarga}
                    onReintentar={cargar}
                    vacio={documentos?.length === 0}
                    textoVacio="Todavía no hay documentos cargados."
                  />
                </tbody>
              </table>
            </div>
          </>
        )}
      </PanelDePestana>

      {editando && (
        <FormularioDocumento
          inicial={editando}
          onGuardar={guardar}
          onCerrar={() => setEditando(null)}
        />
      )}
      {documento.visor}
    </div>
  );
}
