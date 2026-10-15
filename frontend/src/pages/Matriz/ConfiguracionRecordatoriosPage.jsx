import { useCallback, useEffect, useState } from "react";

import { getEmpresaActiva } from "../../api/client";
import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { ESTADO_DE_NOTIFICACION, textoDeAnticipacion } from "./avisosMatriz";
import { fechaHora } from "./formatoMatriz";
import "./Matriz.css";

const FILTROS = [
  ["", "Todas"],
  ["enviado", "Enviadas"],
  ["fallido", "Fallidas"],
  ["reintentado", "Reintentadas"],
];

/** Los nombres de la API a los del formulario, y de vuelta. */
function aFormulario(datos) {
  return {
    offsets: datos.offsets,
    send_time: datos.send_time,
    copy_backup: datos.copy_backup,
    escalation_enabled: datos.escalation_enabled,
    escalation_days: datos.escalation_days,
    escalation_repeat_days: datos.escalation_repeat_days,
  };
}

/**
 * Configuración → Recordatorios (§15.9): cuándo y a quién avisa la Matriz en
 * la empresa activa, y el historial de notificaciones con «Reintentar» en las
 * fallidas. La ve cualquiera con un rol de la Matriz; la cambia quien tiene
 * `configurar`, y el historial lo ve quien tiene `ver_auditoria`.
 */
export function ConfiguracionRecordatoriosPage() {
  const [empresa, setEmpresa] = useState(undefined);
  const [config, setConfig] = useState(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [nueva, setNueva] = useState("");
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const [aviso, setAviso] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    matrizService
      .misEmpresas()
      .then(({ empresas }) => {
        const activa = String(getEmpresaActiva() ?? "");
        const encontrada =
          empresas.find((e) => String(e.id) === activa) ??
          (activa ? null : empresas[0]);
        setEmpresa(encontrada ?? null);
        if (!encontrada) return;
        matrizService
          .configuracionRecordatorios()
          .then((datos) => {
            setConfig(aFormulario(datos));
            setPuedeEditar(datos.can_edit);
          })
          .catch((err) =>
            setError(
              mensajeDeError(err, "No se pudo cargar la configuración."),
            ),
          );
      })
      .catch((err) => {
        setEmpresa(null);
        setError(mensajeDeError(err, "No se pudo cargar la Matriz."));
      });
  }, []);

  function fijar(campo, valor) {
    setConfig((actual) => ({ ...actual, [campo]: valor }));
    setAviso(null);
  }

  function agregarAnticipacion(evento) {
    evento.preventDefault();
    const dias = Number(nueva);
    if (!Number.isInteger(dias) || dias < 1 || dias > 90) {
      setErrores({ offsets: "Entre 1 y 90 días." });
      return;
    }
    setErrores({});
    if (!config.offsets.includes(dias)) {
      fijar(
        "offsets",
        [...config.offsets, dias].sort((a, b) => b - a),
      );
    }
    setNueva("");
  }

  async function guardar(evento) {
    evento.preventDefault();
    setIsSaving(true);
    setError(null);
    setErrores({});
    try {
      const datos = await matrizService.guardarConfiguracionRecordatorios({
        ...config,
        escalation_days: Number(config.escalation_days),
        escalation_repeat_days: Number(config.escalation_repeat_days),
      });
      setConfig(aFormulario(datos));
      setAviso("Configuración guardada.");
    } catch (err) {
      const campos = err?.response?.data;
      if (campos && typeof campos === "object" && !campos.detail) {
        setErrores(
          Object.fromEntries(
            Object.entries(campos).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(" ") : String(v),
            ]),
          ),
        );
      } else {
        setError(mensajeDeError(err, "No se pudo guardar la configuración."));
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (empresa === undefined) return <div className="mz-empty">Cargando…</div>;

  if (!empresa) {
    return (
      <div className="mz-card">
        <div className="mz-empty">
          <Icon name="shield-lock" />
          <p className="mb-1">
            No tiene un rol de la Matriz en la empresa activa.
          </p>
          <p className="mz-small mb-0">
            Los recordatorios se configuran por empresa: cambie de empresa desde
            la barra superior o pida un rol a un administrador.
          </p>
        </div>
      </div>
    );
  }

  const zona = empresa.zona_horaria;
  const verHistorial = empresa.capacidades.includes("matriz.ver_auditoria");
  const puedeReintentar = empresa.capacidades.includes("matriz.recordar");

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Recordatorios</h2>
          <p className="mz-desc">
            Cuándo y a quién avisa la Matriz de obligaciones en {empresa.nombre}
            , en hora de {zona}.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}
      {config && !puedeEditar && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          Puede consultar la configuración, pero cambiarla exige el permiso
          «Configurar la empresa y sus recordatorios».
        </div>
      )}

      {!config && !error && <div className="mz-empty">Cargando…</div>}

      {config && (
        <div className="mz-grid-2">
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Cuándo se avisa</h3>
            </div>
            <form onSubmit={guardar} className="mz-card-body">
              <fieldset disabled={!puedeEditar || isSaving}>
                <div className="mz-section">
                  <h4 id="rec-anticipaciones">Anticipaciones</h4>
                  <ul
                    className="matriz-anticipaciones"
                    aria-labelledby="rec-anticipaciones"
                  >
                    {config.offsets.map((dias) => (
                      <li key={dias} className="mz-pill mz-pill--neutral">
                        {textoDeAnticipacion(dias)}
                        {dias !== 0 && puedeEditar && (
                          <button
                            type="button"
                            className="matriz-quitar"
                            aria-label={`Quitar ${textoDeAnticipacion(dias)}`}
                            onClick={() =>
                              fijar(
                                "offsets",
                                config.offsets.filter((d) => d !== dias),
                              )
                            }
                          >
                            <Icon name="x" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {puedeEditar && (
                    <div className="mz-inline-add">
                      <label className="visually-hidden" htmlFor="rec-nueva">
                        Días antes del vencimiento
                      </label>
                      <input
                        id="rec-nueva"
                        type="number"
                        min={1}
                        max={90}
                        className="form-control form-control-sm matriz-dias"
                        placeholder="Días"
                        value={nueva}
                        onChange={(e) => setNueva(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={agregarAnticipacion}
                      >
                        <Icon name="plus-lg" /> Agregar
                      </button>
                    </div>
                  )}
                  {errores.offsets && (
                    <div className="mz-field-error">{errores.offsets}</div>
                  )}
                  <p className="mz-small mz-faint mt-2 mb-0">
                    El día del vencimiento siempre se avisa.
                  </p>
                </div>

                <div className="mz-section">
                  <div className="mz-field">
                    <label htmlFor="rec-hora">Hora de envío</label>
                    <input
                      id="rec-hora"
                      type="time"
                      className="form-control matriz-hora"
                      required
                      value={config.send_time}
                      onChange={(e) => fijar("send_time", e.target.value)}
                    />
                    {errores.send_time && (
                      <div className="mz-field-error">{errores.send_time}</div>
                    )}
                  </div>
                  <div className="form-check form-switch mt-3">
                    <input
                      id="rec-suplente"
                      type="checkbox"
                      className="form-check-input"
                      checked={config.copy_backup}
                      onChange={(e) => fijar("copy_backup", e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="rec-suplente">
                      Enviar copia al suplente
                    </label>
                  </div>
                </div>

                <div className="mz-section">
                  <h4>Escalamiento</h4>
                  <div className="form-check form-switch">
                    <input
                      id="rec-escalar"
                      type="checkbox"
                      className="form-check-input"
                      checked={config.escalation_enabled}
                      onChange={(e) =>
                        fijar("escalation_enabled", e.target.checked)
                      }
                    />
                    <label className="form-check-label" htmlFor="rec-escalar">
                      Avisar al supervisor (o al aprobador) cuando hay atraso
                    </label>
                  </div>
                  {config.escalation_enabled && (
                    <div className="mz-field-grid mt-3">
                      <div className="mz-field">
                        <label htmlFor="rec-dias">Días de atraso</label>
                        <input
                          id="rec-dias"
                          type="number"
                          min={1}
                          max={30}
                          className="form-control"
                          value={config.escalation_days}
                          onChange={(e) =>
                            fijar("escalation_days", e.target.value)
                          }
                        />
                        {errores.escalation_days && (
                          <div className="mz-field-error">
                            {errores.escalation_days}
                          </div>
                        )}
                      </div>
                      <div className="mz-field">
                        <label htmlFor="rec-repetir">Repetir cada (días)</label>
                        <input
                          id="rec-repetir"
                          type="number"
                          min={0}
                          max={30}
                          className="form-control"
                          value={config.escalation_repeat_days}
                          onChange={(e) =>
                            fijar("escalation_repeat_days", e.target.value)
                          }
                        />
                        <div className="form-text">0 = una sola vez.</div>
                        {errores.escalation_repeat_days && (
                          <div className="mz-field-error">
                            {errores.escalation_repeat_days}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </fieldset>

              {puedeEditar && (
                <div className="mz-actions">
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={isSaving}
                  >
                    {isSaving ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              )}
            </form>
          </section>

          {verHistorial ? (
            <HistorialDeNotificaciones
              zona={zona}
              puedeReintentar={puedeReintentar}
            />
          ) : (
            <section className="mz-card">
              <div className="mz-card-head">
                <h3>Notificaciones</h3>
              </div>
              <div className="mz-empty">
                <Icon name="lock" />
                <div>
                  El historial de la empresa lo ven quienes tienen el permiso
                  «Ver el historial y las notificaciones de la empresa». Los de
                  cada período están en su pestaña Recordatorios.
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function HistorialDeNotificaciones({ zona, puedeReintentar }) {
  const [filtro, setFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [reintentando, setReintentando] = useState(null);

  const cargar = useCallback(() => {
    const params = { page: pagina };
    if (filtro) params.status = filtro;
    matrizService
      .notificaciones(params)
      .then(setDatos)
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudieron cargar las notificaciones."),
        ),
      );
  }, [filtro, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function reintentar(id) {
    setReintentando(id);
    setError(null);
    try {
      await matrizService.reintentarNotificacion(id);
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo reintentar el aviso."));
    } finally {
      setReintentando(null);
    }
  }

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Notificaciones</h3>
        {datos && <span className="mz-faint">{datos.count}</span>}
      </div>
      <div className="mz-card-body">
        <div className="mz-chips mb-3" role="group" aria-label="Filtrar">
          {FILTROS.map(([valor, nombre]) => (
            <button
              key={valor || "todas"}
              type="button"
              className={filtro === valor ? "is-on" : ""}
              aria-pressed={filtro === valor}
              onClick={() => {
                setFiltro(valor);
                setPagina(1);
              }}
            >
              {nombre}
            </button>
          ))}
        </div>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        {!datos && !error && <div className="mz-empty">Cargando…</div>}
        {datos?.results.length === 0 && (
          <div className="mz-empty">
            <Icon name="envelope" />
            <div>No hay notificaciones con este filtro.</div>
          </div>
        )}
        {datos?.results.map((n) => {
          const estado = ESTADO_DE_NOTIFICACION[n.estado];
          return (
            <div key={n.id} className="matriz-notificacion">
              <div className="matriz-notificacion__info">
                <strong>
                  {n.periodo.codigo} · {n.periodo.obligacion}
                </strong>
                <span className="mz-small mz-faint">
                  {n.tipo_nombre} a {n.correo} · {fechaHora(n.created_at, zona)}{" "}
                  · {n.disparado_por}
                  {n.intentos > 1 && ` · intento ${n.intentos}`}
                </span>
                {n.estado === "fallido" && n.ultimo_error && (
                  <span className="mz-small mz-faint matriz-error">
                    {n.ultimo_error}
                  </span>
                )}
              </div>
              <span className={`mz-pill ${estado.clase}`}>{estado.texto}</span>
              {n.estado === "fallido" && puedeReintentar && (
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={reintentando === n.id}
                  onClick={() => reintentar(n.id)}
                >
                  <Icon name="arrow-repeat" /> Reintentar
                </button>
              )}
            </div>
          );
        })}
        {datos && (datos.previous || datos.next) && (
          <div className="mz-actions mt-3">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={!datos.previous}
              onClick={() => setPagina((p) => p - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={!datos.next}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguiente
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
