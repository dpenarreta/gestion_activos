import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { sugerenciasService } from "../../api/sugerenciasService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useModalA11y } from "../../hooks/useModalA11y";
import { blobDeImagen } from "../../utils/blobs";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import "./Institucional.css";

const TIPOS = {
  sugerencia: { nombre: "Sugerencia", icono: "lightbulb" },
  error: { nombre: "Error", icono: "bug" },
};
const CERRADOS = new Set(["resuelto", "descartado"]);

function Ventana({ titulo, onCerrar, children, ancha = false }) {
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
        className={`mz-modal${ancha ? " mz-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">{children}</div>
      </div>
    </div>
  );
}

function Estado({ estado, texto }) {
  return (
    <span className={`sugerencia-estado sugerencia-estado--${estado}`}>
      {texto}
    </span>
  );
}

/** Reportar: tipo, módulo, título, descripción, impacto (si es un error) y
 * una captura opcional. */
function NuevoReporte({ opciones, onCreado, onCerrar, enLinea = false }) {
  const [valores, setValores] = useState({
    tipo: "sugerencia",
    modulo: "",
    titulo: "",
    descripcion: "",
    impacto: "",
  });
  const [captura, setCaptura] = useState(null);
  const [error, setError] = useState(null);
  // Errores del servidor junto a su campo (auditoría UX/UI, fase 2,
  // 28/10/2026).
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const formulario = useRef(null);
  const fijar = (campo) => (e) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));
  const esError = valores.tipo === "error";

  async function enviar(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    setErrores({});
    try {
      onCreado(
        await sugerenciasService.reportar(
          { ...valores, impacto: esError ? valores.impacto : "" },
          captura,
        ),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar el reporte."));
      setErrores(erroresPorCampo(err));
      setEnviando(false);
      enfocarPrimerError(formulario.current);
    }
  }

  return (
    <Envoltura enLinea={enLinea} onCerrar={onCerrar}>
      <form ref={formulario} className="mz-stack" onSubmit={enviar}>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        <LeyendaObligatorios />
        <fieldset className="sugerencia-tipos">
          <legend className="form-label mz-small">¿Qué quiere reportar?</legend>
          {Object.entries(TIPOS).map(([id, t]) => (
            <label
              key={id}
              className={`sugerencia-tipo${valores.tipo === id ? " is-activo" : ""}`}
            >
              <input
                type="radio"
                name="tipo"
                value={id}
                checked={valores.tipo === id}
                onChange={fijar("tipo")}
              />
              <Icon name={t.icono} />
              <span>
                <strong>
                  {id === "error" ? "Un error del sistema" : "Una sugerencia"}
                </strong>
                <small className="mz-faint">
                  {id === "error"
                    ? "Algo no funciona como debería."
                    : "Una mejora o algo nuevo que le sería útil."}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <Campo
          id="sug-modulo"
          etiqueta="Módulo"
          obligatorio
          error={errores.modulo}
        >
          <select
            className="form-select form-select-sm"
            value={valores.modulo}
            onChange={fijar("modulo")}
          >
            <option value="">Elija el módulo</option>
            {opciones.modulos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo
          id="sug-titulo"
          etiqueta="Título"
          obligatorio
          error={errores.titulo}
        >
          <input
            maxLength={150}
            className="form-control form-control-sm"
            placeholder={
              esError
                ? "Ej.: El organigrama se queda cargando"
                : "Ej.: Poder exportar mis vacaciones"
            }
            value={valores.titulo}
            onChange={fijar("titulo")}
          />
        </Campo>
        <Campo
          id="sug-descripcion"
          etiqueta={
            esError
              ? "¿Qué pasó? ¿Qué estaba haciendo y qué esperaba que pasara?"
              : "Cuéntenos su idea"
          }
          obligatorio
          error={errores.descripcion}
        >
          <textarea
            rows={5}
            maxLength={4000}
            className="form-control form-control-sm"
            value={valores.descripcion}
            onChange={fijar("descripcion")}
          />
        </Campo>
        {esError && (
          <Campo
            id="sug-impacto"
            etiqueta="¿Cuánto le afecta?"
            obligatorio
            error={errores.impacto}
          >
            <select
              className="form-select form-select-sm"
              value={valores.impacto}
              onChange={fijar("impacto")}
            >
              <option value="">Elija</option>
              {opciones.impactos.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <Campo
          id="sug-captura"
          etiqueta="Captura de pantalla (opcional)"
          ayuda="PNG o JPG, hasta 5 MB."
          error={errores.captura}
        >
          <input
            type="file"
            accept=".png,.jpg,.jpeg"
            className="form-control form-control-sm"
            onChange={(e) => setCaptura(e.target.files?.[0] ?? null)}
          />
        </Campo>
        <div className="mz-actions justify-content-end">
          {!enLinea && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cancelar
            </button>
          )}
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={enviando}
          >
            {enviando ? "Enviando…" : "Enviar reporte"}
          </button>
        </div>
      </form>
    </Envoltura>
  );
}

function Envoltura({ enLinea, onCerrar, children }) {
  if (enLinea)
    return (
      <section className="mz-card" aria-label="Nuevo reporte">
        <div className="mz-card-body">{children}</div>
      </section>
    );
  return (
    <Ventana titulo="Nuevo reporte" onCerrar={onCerrar}>
      {children}
    </Ventana>
  );
}

/** El detalle de un reporte: su descripción, captura y conversación; quien
 * gestiona cambia su estado. */
function DetalleReporte({ id, opciones, onCambio, onCerrar }) {
  const [reporte, setReporte] = useState(null);
  const [imagen, setImagen] = useState(null);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState("");
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    sugerenciasService
      .detalle(id)
      .then(setReporte)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo abrir el reporte.")),
      );
  }, [id]);

  useEffect(() => {
    if (!reporte?.tiene_captura) return undefined;
    let url;
    sugerenciasService
      .captura(reporte.id)
      .then((blob) => {
        // La captura se abre en otra pestaña: solo con un tipo de imagen de
        // la lista, nunca el que traiga la respuesta (auditoría de seguridad,
        // 29/10/2026).
        const captura = blobDeImagen(blob);
        if (!captura) {
          setImagen(null);
          setError("No se pudo cargar la captura.");
          return;
        }
        url = URL.createObjectURL(captura);
        setImagen(url);
      })
      .catch((err) => {
        // Antes la captura simplemente no aparecía (auditoría UX/UI, fase 2).
        setImagen(null);
        setError(mensajeDeError(err, "No se pudo cargar la captura."));
      });
    return () => url && URL.revokeObjectURL(url);
  }, [reporte?.id, reporte?.tiene_captura]);

  async function hacer(accion) {
    setTrabajando(true);
    setError(null);
    try {
      setReporte(await accion());
      setTexto("");
      setEstado("");
      onCambio();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <Ventana
      titulo={reporte ? `#${reporte.id} · ${reporte.titulo}` : "Reporte"}
      onCerrar={onCerrar}
      ancha
    >
      {error && (
        <div className="mz-alert mz-alert--bad mb-3" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {/* Mientras llegan los datos, la ventana no queda en blanco. */}
      {!reporte && !error && <EstadoDeCarga cargando />}
      {reporte && (
        <div className="mz-stack">
          <div className="sugerencia-datos">
            <span>
              <Icon name={TIPOS[reporte.tipo]?.icono} /> {reporte.tipo_display}
            </span>
            <span>{reporte.modulo_display}</span>
            {reporte.impacto && (
              <span>Impacto: {reporte.impacto_display.split(":")[0]}</span>
            )}
            <Estado estado={reporte.estado} texto={reporte.estado_display} />
            <span className="mz-faint">
              {reporte.autor.nombre} · {formatearFecha(reporte.created_at)}
            </span>
          </div>
          <p className="sugerencia-descripcion">{reporte.descripcion}</p>
          {imagen && (
            <a href={imagen} target="_blank" rel="noreferrer">
              <img
                src={imagen}
                alt="Captura adjunta al reporte"
                className="sugerencia-captura"
              />
            </a>
          )}

          <section aria-label="Conversación">
            <h4 className="inicio-titulo">Conversación</h4>
            {reporte.comentarios.length === 0 ? (
              <p className="mz-faint mb-0">Todavía no hay comentarios.</p>
            ) : (
              <ol className="sugerencia-comentarios">
                {reporte.comentarios.map((c) => (
                  <li key={c.id}>
                    <strong>{c.autor.nombre}</strong>{" "}
                    <small className="mz-faint">
                      {formatearFecha(c.created_at)}
                    </small>
                    {c.estado_nuevo && (
                      <div>
                        <small>Pasó a </small>
                        <Estado
                          estado={c.estado_nuevo}
                          texto={c.estado_nuevo_display}
                        />
                      </div>
                    )}
                    {c.texto && <p className="mb-0">{c.texto}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="mz-stack">
            <label className="form-label mz-small mb-0" htmlFor="sug-texto">
              {opciones.gestiona ? "Respuesta o nota" : "Agregar un comentario"}
            </label>
            <textarea
              id="sug-texto"
              rows={3}
              className="form-control form-control-sm"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
            <div className="mz-actions justify-content-end">
              {opciones.gestiona && (
                <>
                  <select
                    aria-label="Cambiar estado"
                    className="form-select form-select-sm sugerencia-cambiar"
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                  >
                    <option value="">Cambiar estado…</option>
                    {opciones.estados
                      .filter((e) => e.id !== reporte.estado)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.nombre}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    disabled={!estado || trabajando}
                    title={
                      CERRADOS.has(estado)
                        ? "Al cerrarlo, explique cómo se resolvió o por qué se descarta"
                        : undefined
                    }
                    onClick={() =>
                      hacer(() =>
                        sugerenciasService.cambiarEstado(
                          reporte.id,
                          estado,
                          texto,
                        ),
                      )
                    }
                  >
                    Aplicar estado
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!texto.trim() || trabajando}
                onClick={() =>
                  hacer(() => sugerenciasService.comentar(reporte.id, texto))
                }
              >
                Comentar
              </button>
            </div>
          </div>
        </div>
      )}
    </Ventana>
  );
}

/**
 * Institucional → Sugerencias y errores. Los reportes son reservados: quien no
 * tiene `sugerencias.gestionar` solo ve el formulario para enviar uno nuevo;
 * quien lo tiene ve «Mis reportes» y «Todos», los conversa y cambia su estado.
 */
export function SugerenciasPage() {
  const [parametros, setParametros] = useSearchParams();
  const [opciones, setOpciones] = useState(null);
  const [vista, setVista] = useState("mios");
  const [filtros, setFiltros] = useState({ estado: "", tipo: "" });
  const [lista, setLista] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  // Cada envío vuelve a montar el formulario en blanco.
  const [formulario, setFormulario] = useState(0);
  const abierto = parametros.get("reporte");
  const gestiona = Boolean(opciones?.gestiona);

  // El error de la lista va aparte del de las opciones: «Reintentar» vuelve a
  // pedir la lista (auditoría UX/UI, fase 2, 28/10/2026).
  const [errorLista, setErrorLista] = useState(null);

  const cargarOpciones = useCallback(() => {
    setError(null);
    sugerenciasService
      .opciones()
      .then(setOpciones)
      .catch((err) => setError(mensajeDeError(err, "No se pudo cargar.")));
  }, []);

  useEffect(() => {
    cargarOpciones();
  }, [cargarOpciones]);

  const cargar = useCallback(() => {
    if (!gestiona) return;
    const activos = Object.fromEntries(
      Object.entries(filtros).filter(([, v]) => v),
    );
    // Se vacía antes de pedir: «Cargando…» y no la lista anterior con otras
    // columnas.
    setLista(null);
    setErrorLista(null);
    sugerenciasService
      .listar(vista, activos)
      .then(setLista)
      .catch((err) =>
        setErrorLista(
          mensajeDeError(err, "No se pudieron cargar los reportes."),
        ),
      );
  }, [vista, filtros, gestiona]);
  const hayFiltros = Boolean(filtros.estado || filtros.tipo);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function abrir(id) {
    const nuevos = new URLSearchParams(parametros);
    if (id) nuevos.set("reporte", id);
    else nuevos.delete("reporte");
    setParametros(nuevos);
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Sugerencias y errores</h2>
          <p className="mz-desc">
            ¿Tiene una idea para mejorar el sistema o encontró algo que no
            funciona? Cuéntenos aquí. Su reporte es reservado: solo lo ve el
            equipo que los atiende, y le avisaremos cuando cambie de estado.
          </p>
        </div>
        {gestiona && (
          <div className="mz-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!opciones}
              onClick={() => setNuevo(true)}
            >
              <Icon name="plus-lg" /> Nuevo reporte
            </button>
          </div>
        )}
      </div>

      {gestiona && (
        <Pestanas
          etiqueta="Reportes"
          idBase="sug"
          valor={vista}
          onCambio={setVista}
          opciones={[
            { id: "mios", etiqueta: "Mis reportes" },
            { id: "todos", etiqueta: "Todos" },
          ]}
        />
      )}

      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}
      <EstadoDeCarga
        cargando={opciones === null}
        error={error}
        onReintentar={cargarOpciones}
      />

      {opciones && !gestiona && (
        <NuevoReporte
          key={formulario}
          enLinea
          opciones={opciones}
          onCreado={(reporte) => {
            setAviso(
              `Gracias: su reporte #${reporte.id} quedó registrado. Le avisaremos cuando cambie de estado.`,
            );
            setFormulario((n) => n + 1);
          }}
        />
      )}

      {gestiona && (
        <PanelDePestana idBase="sug" valor={vista} className="mz-stack">
          <div className="d-flex flex-wrap gap-2">
            <select
              aria-label="Filtrar por tipo"
              className="form-select form-select-sm sugerencia-filtro"
              value={filtros.tipo}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, tipo: e.target.value }))
              }
            >
              <option value="">Sugerencias y errores</option>
              <option value="sugerencia">Solo sugerencias</option>
              <option value="error">Solo errores</option>
            </select>
            <select
              aria-label="Filtrar por estado"
              className="form-select form-select-sm sugerencia-filtro"
              value={filtros.estado}
              onChange={(e) =>
                setFiltros((f) => ({ ...f, estado: e.target.value }))
              }
            >
              <option value="">Todos los estados</option>
              {opciones.estados.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>

          <EstadoDeCarga
            cargando={lista === null}
            error={errorLista}
            onReintentar={cargar}
            vacio={lista?.length === 0}
            textoVacio={
              vista === "mios"
                ? "Todavía no ha enviado reportes."
                : "Todavía no hay reportes."
            }
            hayFiltros={hayFiltros}
            onLimpiarFiltros={() => setFiltros({ estado: "", tipo: "" })}
          />
          {lista && lista.length > 0 && (
            <div className="mz-card">
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Tipo</th>
                      <th>Título</th>
                      <th>Módulo</th>
                      {vista === "todos" && <th>Reportó</th>}
                      <th>Estado</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>
                          <Icon name={TIPOS[r.tipo]?.icono} />{" "}
                          {TIPOS[r.tipo]?.nombre}
                          {r.impacto === "alto" && (
                            <span className="sugerencia-estado sugerencia-estado--alto ms-1">
                              Alto
                            </span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 text-start"
                            onClick={() => abrir(r.id)}
                          >
                            {r.titulo}
                          </button>
                        </td>
                        <td>{r.modulo_display}</td>
                        {vista === "todos" && <td>{r.autor.nombre}</td>}
                        <td>
                          <Estado estado={r.estado} texto={r.estado_display} />
                        </td>
                        <td>{formatearFecha(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </PanelDePestana>
      )}

      {nuevo && opciones && (
        <NuevoReporte
          opciones={opciones}
          onCerrar={() => setNuevo(false)}
          onCreado={(reporte) => {
            setNuevo(false);
            setAviso(`Reporte #${reporte.id} registrado.`);
            setVista("mios");
            cargar();
          }}
        />
      )}
      {abierto && gestiona && (
        <DetalleReporte
          id={abierto}
          opciones={opciones}
          onCambio={cargar}
          onCerrar={() => abrir(null)}
        />
      )}
    </div>
  );
}
