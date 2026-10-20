import { useCallback, useEffect, useMemo, useState } from "react";

import { getEmpresaActiva } from "../../api/client";
import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { useUltimaPeticion } from "../../hooks/useUltimaPeticion";
import { mensajeDeError } from "../../utils/errores";
import { fechaHora } from "./formatoMatriz";
import "./Matriz.css";

/** Las acciones del historial (§17), con su nombre para el filtro. */
export const ACCIONES = [
  ["period.created", "Período creado"],
  ["period.updated", "Seguimiento editado"],
  ["period.due_date_changed", "Fecha cambiada"],
  ["period.submitted", "Enviado a validación"],
  ["period.validated", "Validado"],
  ["period.returned", "Devuelto"],
  ["document.uploaded", "Evidencia cargada"],
  ["document.rejected", "Evidencia rechazada"],
  ["document.deleted", "Evidencia eliminada"],
  ["reminder.sent", "Recordatorio reenviado"],
  ["reminder.escalated", "Escalamiento"],
];

/**
 * Configuración → Auditoría → Matriz (§15.9): el historial de los períodos de
 * la empresa activa, del más reciente al más antiguo, con filtros por
 * persona, acción y fechas. Exige `ver_auditoria` en la empresa.
 */
export function AuditoriaMatriz({ incrustada = false }) {
  const [zona, setZona] = useState(undefined);
  const [personas, setPersonas] = useState([]);
  const [filtros, setFiltros] = useState({
    actor: "",
    action: "",
    from: "",
    to: "",
  });
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    matrizService
      .misEmpresas()
      .then(({ empresas }) => {
        const activa = String(getEmpresaActiva() ?? "");
        setZona(
          (empresas.find((e) => String(e.id) === activa) ?? empresas[0])
            ?.zona_horaria,
        );
      })
      .catch(() => {});
    matrizService
      .personas()
      .then(setPersonas)
      .catch(() => setPersonas([]));
  }, []);

  const params = useMemo(
    () => ({
      page: pagina,
      ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)),
    }),
    [filtros, pagina],
  );

  const nuevaPeticion = useUltimaPeticion();
  const cargar = useCallback(() => {
    const vigente = nuevaPeticion();
    matrizService
      .auditoria(params)
      .then((respuesta) => {
        if (!vigente()) return;
        setDatos(respuesta);
        setError(null);
      })
      .catch(
        (err) =>
          vigente() &&
          setError(mensajeDeError(err, "No se pudo cargar la auditoría.")),
      );
  }, [params, nuevaPeticion]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function fijar(campo, valor) {
    setFiltros((actuales) => ({ ...actuales, [campo]: valor }));
    setPagina(1);
  }

  return (
    <div>
      {/* Dentro de la Auditoría unificada, el encabezado lo pone ella. */}
      {!incrustada && (
        <div className="mz-view-head">
          <div>
            <h2>Auditoría de la Matriz</h2>
            <p className="mz-desc">
              Quién hizo qué en los períodos de la empresa activa. Es de solo
              lectura: el historial no se edita ni se borra.
            </p>
          </div>
        </div>
      )}
      {incrustada && (
        <p className="mz-faint mz-small">
          Quién hizo qué en los períodos de la Matriz de la empresa activa.
        </p>
      )}

      <div className="mz-filter-bar">
        <select
          className="form-select form-select-sm"
          aria-label="Persona"
          value={filtros.actor}
          onChange={(e) => fijar("actor", e.target.value)}
        >
          <option value="">Todas las personas</option>
          <option value="sistema">Sistema</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          aria-label="Acción"
          value={filtros.action}
          onChange={(e) => fijar("action", e.target.value)}
        >
          <option value="">Todas las acciones</option>
          {ACCIONES.map(([valor, nombre]) => (
            <option key={valor} value={valor}>
              {nombre}
            </option>
          ))}
        </select>
        <div className="mz-inline-field">
          <label htmlFor="aud-desde">Desde</label>
          <input
            id="aud-desde"
            type="date"
            className="form-control form-control-sm"
            value={filtros.from}
            onChange={(e) => fijar("from", e.target.value)}
          />
        </div>
        <div className="mz-inline-field">
          <label htmlFor="aud-hasta">Hasta</label>
          <input
            id="aud-hasta"
            type="date"
            className="form-control form-control-sm"
            value={filtros.to}
            onChange={(e) => fijar("to", e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {!datos && !error && <div className="mz-empty">Cargando…</div>}

      {datos && (
        <section className="mz-card">
          {datos.results.length === 0 ? (
            <div className="mz-empty">
              <Icon name="journal" />
              <div>Nada registrado con estos filtros.</div>
            </div>
          ) : (
            <div className="mz-table-wrap">
              <table className="mz-table">
                <thead>
                  <tr>
                    <th>Cuándo</th>
                    <th>Quién</th>
                    <th>Período</th>
                    <th>Qué</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.results.map((evento) => (
                    <tr key={evento.id}>
                      <td className="text-nowrap">
                        {fechaHora(evento.created_at, zona)}
                      </td>
                      <td>{evento.actor}</td>
                      <td>
                        <span className="mz-mono">{evento.periodo.codigo}</span>
                        <div className="mz-small mz-faint">
                          {evento.periodo.obligacion} ·{" "}
                          {evento.periodo.etiqueta}
                        </div>
                      </td>
                      <td>
                        {evento.descripcion}
                        {(evento.valor_anterior || evento.valor_nuevo) && (
                          <div className="mz-small mz-faint">
                            {evento.valor_anterior || "—"} →{" "}
                            {evento.valor_nuevo || "—"}
                          </div>
                        )}
                        {evento.motivo && (
                          <div className="mz-small mz-faint">
                            {evento.motivo}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(datos.previous || datos.next) && (
            <div className="mz-actions m-3">
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
        </section>
      )}
    </div>
  );
}
