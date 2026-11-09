import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  NOVA_CONOCIMIENTO_GESTIONAR,
  errorDeNova,
  novaService,
} from "../../../api/novaService";
import { AnuncioDeResultados } from "../../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { VisorPdf } from "../../../components/common/VisorPdf/VisorPdf";
import { useBusquedaEnVivo } from "../../../hooks/useBusquedaEnVivo";
import { usePermission } from "../../../hooks/usePermission";
import { useNovaChatOpcional } from "../../../components/admin/NovaChat/NovaChatContext";
import "../../../components/admin/NovaChat/ConversacionNova.css";

/** Tope por defecto (`NOVA_CONOCIMIENTO_TAMANO_MAXIMO_MB`); el servidor manda. */
const MAXIMO_MB = 10;

function tamano(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fecha(iso) {
  return iso ? new Date(iso).toLocaleDateString("es-EC") : "—";
}

/**
 * Un mensaje de resultado (`{ tipo: "ok" | "bad", texto }`): el éxito como
 * `status` con su check y el error como `alert` con su triángulo. Las dos
 * regiones vivas quedan siempre montadas para que el lector las anuncie.
 */
function MensajeResultado({ mensaje, className = "" }) {
  const ok = mensaje?.tipo === "ok";
  const bad = mensaje?.tipo === "bad";
  return (
    <>
      <div role="status" className={ok ? className : undefined}>
        {ok && (
          <p className="mz-alert mz-alert--ok mb-0">
            <Icon name="check-circle" />
            <span>{mensaje.texto}</span>
          </p>
        )}
      </div>
      <div role="alert" className={bad ? className : undefined}>
        {bad && (
          <p className="mz-alert mz-alert--bad mb-0">
            <Icon name="exclamation-triangle" />
            <span>{mensaje.texto}</span>
          </p>
        )}
      </div>
    </>
  );
}

/**
 * «Responder solo con las fuentes» (ajuste por empresa, activado por
 * defecto). Solo para quien gestiona la base; el servidor lo vuelve a
 * comprobar y lo deja en la auditoría.
 */
function AjusteSoloFuentes({ valor, onCambiado }) {
  const id = useId();
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  async function cambiar(evento) {
    if (guardando) return;
    const nuevo = evento.target.checked;
    setGuardando(true);
    setMensaje(null);
    try {
      const datos = await novaService.cambiarAjustes({ solo_fuentes: nuevo });
      onCambiado(datos.solo_fuentes);
      setMensaje({
        tipo: "ok",
        texto: datos.solo_fuentes
          ? "Listo: Nova responde solo con los documentos de la base de conocimiento."
          : "Listo: si los documentos no cubren la pregunta, Nova puede responder con conocimiento general (y cita los documentos que use).",
      });
    } catch (err) {
      setMensaje({
        tipo: "bad",
        texto: errorDeNova(err, "No se pudo guardar el ajuste.").mensaje,
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="mz-card p-3 mb-3" aria-labelledby={`${id}-titulo`}>
      <h3 id={`${id}-titulo`} className="h6 mb-2">
        Cómo responde Nova
      </h3>
      <div className="form-check form-switch mb-1">
        <input
          id={`${id}-solo`}
          className="form-check-input"
          type="checkbox"
          role="switch"
          checked={valor}
          onChange={cambiar}
          aria-describedby={`${id}-descripcion`}
          aria-disabled={guardando}
        />
        <label className="form-check-label" htmlFor={`${id}-solo`}>
          Responder solo con las fuentes
        </label>
        {guardando && (
          <span className="mz-small ms-2" role="status">
            <span
              className="spinner-border spinner-border-sm me-1"
              aria-hidden="true"
            />
            Guardando…
          </span>
        )}
      </div>
      {/* Vale para los dos estados: con el interruptor apagado, un texto
          que solo describe el encendido sería falso. */}
      <p id={`${id}-descripcion`} className="mz-small mz-faint mb-0">
        Encendido: Nova responde solo con estos documentos y, si no encuentra la
        respuesta en ellos, lo dice. Apagado: puede completar con conocimiento
        general y cita los documentos que use.
      </p>
      <MensajeResultado mensaje={mensaje} className="mt-2" />
    </section>
  );
}

/** Subir un PDF: título opcional y el archivo. */
function FormularioSubida({ onSubido }) {
  const id = useId();
  const [titulo, setTitulo] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState(null);
  const campoArchivo = useRef(null);

  async function subir(evento) {
    evento.preventDefault();
    if (subiendo) return;
    setExito(null);
    if (!archivo) {
      setError("Elija el documento PDF que quiere subir.");
      campoArchivo.current?.focus();
      return;
    }
    if (archivo.size > MAXIMO_MB * 1024 * 1024) {
      setError(
        `El archivo pesa ${tamano(archivo.size)} y el máximo es ${MAXIMO_MB} MB.`,
      );
      campoArchivo.current?.focus();
      return;
    }
    setSubiendo(true);
    setError("");
    try {
      const documento = await novaService.subirDocumento(archivo, titulo);
      setExito({
        tipo: "ok",
        texto: `Se agregó «${documento.titulo}»: ${documento.paginas} páginas, ${documento.fragmentos} fragmentos para consultar.`,
      });
      setTitulo("");
      setArchivo(null);
      if (campoArchivo.current) campoArchivo.current.value = "";
      onSubido();
    } catch (err) {
      setError(errorDeNova(err, "No se pudo subir el documento.").mensaje);
      campoArchivo.current?.focus();
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <form className="mz-card p-3 mb-3" onSubmit={subir} noValidate>
      <h3 className="h6 mb-2">Agregar un documento</h3>
      <p className="mz-small mz-faint">
        Solo PDF con texto seleccionable (no escaneado como imagen), de hasta{" "}
        {MAXIMO_MB} MB. Nova consulta los fragmentos relevantes de cada
        pregunta; antes de enviarlos se ocultan correos, cédulas y teléfonos.
      </p>
      <div className="row g-2 align-items-end">
        <div className="col-12 col-md-5">
          <label htmlFor={`${id}-titulo`} className="form-label">
            Título (opcional)
          </label>
          <input
            id={`${id}-titulo`}
            className="form-control form-control-sm"
            value={titulo}
            maxLength={200}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Si lo deja vacío, se usa el nombre del archivo"
          />
        </div>
        <div className="col-12 col-md-5">
          <label htmlFor={`${id}-archivo`} className="form-label">
            Documento PDF
          </label>
          <input
            id={`${id}-archivo`}
            ref={campoArchivo}
            type="file"
            accept="application/pdf,.pdf"
            className={`form-control form-control-sm${error ? " is-invalid" : ""}`}
            onChange={(e) => {
              setArchivo(e.target.files?.[0] ?? null);
              setError("");
            }}
            aria-describedby={`${id}-error`}
            aria-invalid={Boolean(error)}
          />
        </div>
        <div className="col-12 col-md-2">
          <button
            type="submit"
            className="btn btn-primary btn-sm w-100"
            aria-disabled={subiendo}
          >
            <Icon name="upload" /> {subiendo ? "Subiendo…" : "Subir"}
          </button>
        </div>
      </div>
      <p
        id={`${id}-error`}
        role="alert"
        className="invalid-feedback d-block mb-0 mt-2"
      >
        {error}
      </p>
      <MensajeResultado mensaje={exito} className="mt-2" />
    </form>
  );
}

/**
 * La base de conocimiento de Nova (Nexo: documentos del asistente en GitHub).
 * Aquí los PDF quedan en el almacenamiento de la intranet y se abren en el
 * visor del sistema. Ver la lista y abrirlos: `nova.conocimiento_ver`; subir y
 * eliminar: `nova.conocimiento_gestionar` (el servidor vuelve a comprobarlo).
 */
export function ConocimientoPage() {
  const gestiona = usePermission(NOVA_CONOCIMIENTO_GESTIONAR);
  const [termino, setTermino] = useState("");
  const [vez, setVez] = useState(0);
  const [estado, setEstado] = useState({
    cargando: true,
    error: null,
    documentos: [],
  });
  const [borrando, setBorrando] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [abriendo, setAbriendo] = useState(null);
  const campoBusqueda = useRef(null);
  const busqueda = useBusquedaEnVivo({ alBuscar: setTermino });
  // «Responder solo con las fuentes» (llega con la lista); null hasta saberlo.
  const [soloFuentes, setSoloFuentes] = useState(null);
  // El chat (si esta página vive dentro de su proveedor) se pone al día al
  // cambiar la base o el ajuste: avisa si la base está vacía.
  const chat = useNovaChatOpcional();
  const actualizarChat = useCallback(() => chat?.cargarEstado?.(true), [chat]);

  useEffect(() => {
    let vigente = true;
    setEstado((actual) => ({ ...actual, cargando: true, error: null }));
    novaService
      .documentos(termino)
      .then((datos) => {
        if (!vigente) return;
        setEstado({
          cargando: false,
          error: null,
          documentos: datos.resultados,
        });
        if (typeof datos.solo_fuentes === "boolean")
          setSoloFuentes(datos.solo_fuentes);
      })
      .catch((err) => {
        if (vigente)
          setEstado((actual) => ({
            ...actual,
            cargando: false,
            error: errorDeNova(
              err,
              "No se pudo cargar la base de conocimiento.",
            ).mensaje,
          }));
      });
    return () => {
      vigente = false;
    };
  }, [termino, vez]);

  const recargar = useCallback(() => setVez((v) => v + 1), []);
  const alSubir = useCallback(() => {
    recargar();
    actualizarChat();
  }, [recargar, actualizarChat]);

  async function abrir(documento) {
    if (abriendo) return;
    setAviso(null);
    setAbriendo(documento.id);
    try {
      const blob = await novaService.archivoDocumento(documento.id);
      setAbierto({ documento, blob });
    } catch (err) {
      setAviso({
        tipo: "bad",
        texto: errorDeNova(err, "No se pudo abrir el documento.").mensaje,
      });
    } finally {
      setAbriendo(null);
    }
  }

  async function eliminar() {
    if (!borrando || eliminando) return;
    setEliminando(true);
    try {
      await novaService.eliminarDocumento(borrando.id);
      setAviso({ tipo: "ok", texto: `Se eliminó «${borrando.titulo}».` });
      setBorrando(null);
      recargar();
      actualizarChat();
      campoBusqueda.current?.focus();
    } catch (err) {
      setAviso({
        tipo: "bad",
        texto: errorDeNova(err, "No se pudo eliminar el documento.").mensaje,
      });
      setBorrando(null);
    } finally {
      setEliminando(false);
    }
  }

  const { cargando, error, documentos } = estado;

  return (
    <div className="nova-conocimiento">
      <div className="mz-view-head">
        <div>
          <h2>Base de conocimiento de Nova</h2>
          <p className="mz-desc">
            Políticas, reglamentos y procedimientos de la empresa que Nova
            consulta para responder. Cita el documento y la página de donde saca
            cada respuesta.
          </p>
        </div>
      </div>

      {gestiona && soloFuentes !== null && (
        <AjusteSoloFuentes
          valor={soloFuentes}
          onCambiado={(valor) => {
            setSoloFuentes(valor);
            actualizarChat();
          }}
        />
      )}

      {gestiona && <FormularioSubida onSubido={alSubir} />}

      <form
        className="mz-filter-bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          busqueda.buscarYa();
        }}
      >
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar documentos</span>
          <input
            type="search"
            placeholder="Buscar por título o nombre del archivo"
            ref={campoBusqueda}
            {...busqueda.propsCampo}
          />
        </label>
      </form>
      <AnuncioDeResultados
        termino={termino}
        total={documentos.length}
        cargando={cargando}
        sustantivo={["documento", "documentos"]}
      />
      <MensajeResultado mensaje={aviso} className="mb-2" />

      <EstadoDeCarga
        cargando={cargando && documentos.length === 0}
        error={error}
        onReintentar={recargar}
        vacio={!cargando && documentos.length === 0}
        textoVacio={
          gestiona
            ? "Todavía no hay documentos. Suba el primero con el formulario de arriba."
            : "Todavía no hay documentos en la base de conocimiento."
        }
        hayFiltros={Boolean(termino)}
        termino={termino}
        onLimpiarFiltros={busqueda.limpiar}
        campoBusquedaRef={campoBusqueda}
        etiquetaLimpiar="Limpiar búsqueda"
      />

      {documentos.length > 0 && (
        <div aria-busy={cargando} className="mz-table-wrap">
          <table className="mz-table">
            <thead>
              <tr>
                <th>Documento</th>
                <th className="num">Páginas</th>
                <th className="num">Tamaño</th>
                <th>Subido</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {documentos.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className="mz-strong">{d.titulo}</div>
                    <div className="mz-small mz-faint">{d.nombre_original}</div>
                  </td>
                  <td className="num">{d.paginas}</td>
                  <td className="num">{tamano(d.tamano_bytes)}</td>
                  <td className="mz-small">
                    {fecha(d.creado)}
                    {d.subido_por ? ` · ${d.subido_por}` : ""}
                  </td>
                  <td className="acciones">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => abrir(d)}
                      aria-disabled={abriendo === d.id}
                    >
                      <Icon name="eye" />{" "}
                      {abriendo === d.id ? "Abriendo…" : "Ver"}
                      <span className="visually-hidden"> {d.titulo}</span>
                    </button>{" "}
                    {gestiona && (
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => setBorrando(d)}
                      >
                        <Icon name="trash" /> Eliminar
                        <span className="visually-hidden"> {d.titulo}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(borrando)}
        title="Eliminar documento"
        message={
          borrando
            ? `Se eliminará «${borrando.titulo}» de la base de conocimiento y Nova dejará de consultarlo. No se puede deshacer.`
            : ""
        }
        confirmLabel="Eliminar"
        confirmVariant="danger"
        isLoading={eliminando}
        onCancel={() => setBorrando(null)}
        onConfirm={eliminar}
      />

      {abierto && (
        <VisorPdf
          titulo={abierto.documento.titulo}
          blob={abierto.blob}
          nombreArchivo={abierto.documento.nombre_original}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </div>
  );
}
