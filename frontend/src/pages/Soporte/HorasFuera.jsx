import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import "./Soporte.css";

const TONO = {
  pendiente: "mz-pill--warn",
  aprobado: "mz-pill--ok",
  rechazado: "mz-pill--bad",
};

/**
 * Horas fuera de horario: cada técnico ve las que registró; quien supervisa
 * las ve todas y las aprueba o rechaza.
 */
export function HorasFuera() {
  const [registros, setRegistros] = useState([]);
  const [estado, setEstado] = useState("pendiente");
  const [puedeAprobar, setPuedeAprobar] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    soporteService
      .horas({ estado })
      .then((datos) => setRegistros(datos.results ?? datos))
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar las horas.")),
      );
  }, [estado]);

  useEffect(() => {
    cargar();
    soporteService
      .bandeja()
      .then((b) => setPuedeAprobar(b.puede.aprobar_horas))
      .catch(() => setPuedeAprobar(false));
  }, [cargar]);

  async function revisar(registro, aprobar) {
    setError(null);
    try {
      await soporteService.revisarHoras(registro.id, aprobar);
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo revisar el registro."));
    }
  }

  return (
    <div className="soporte-page">
      <div className="mz-view-head">
        <div>
          <h2>Horas fuera de horario</h2>
          <p className="mz-desc">
            El tiempo dedicado a tickets fuera del horario de atención.
            {puedeAprobar
              ? " Usted las aprueba o rechaza."
              : " Las revisa su supervisión."}
          </p>
        </div>
      </div>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      <div className="mz-filter-bar">
        <div className="mz-inline-field">
          <label htmlFor="hf-estado">Mostrar</label>
          <select
            id="hf-estado"
            className="form-select form-select-sm"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
          >
            <option value="pendiente">Pendientes</option>
            <option value="aprobado">Aprobadas</option>
            <option value="rechazado">Rechazadas</option>
            <option value="">Todas</option>
          </select>
        </div>
      </div>
      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Técnico</th>
              <th>Ticket</th>
              <th className="num">Horas</th>
              <th>Qué hizo</th>
              <th>Estado</th>
              {puedeAprobar && <th aria-label="Acciones" />}
            </tr>
          </thead>
          <tbody>
            {registros.map((r) => (
              <tr key={r.id}>
                <td>{formatearFecha(r.fecha)}</td>
                <td>{r.tecnico_nombre}</td>
                <td className="mz-mono">
                  <Link to={`/admin/soporte/tickets/${r.ticket}`}>
                    {r.ticket_numero}
                  </Link>
                </td>
                <td className="num mz-mono">{Number(r.horas)}</td>
                <td>{r.descripcion}</td>
                <td>
                  <span className={`mz-pill ${TONO[r.estado]}`}>
                    {r.estado_display}
                  </span>
                  {r.revisado_por_nombre && (
                    <div className="mz-small mz-faint">
                      {r.revisado_por_nombre}
                    </div>
                  )}
                </td>
                {puedeAprobar && (
                  <td className="num">
                    {r.estado === "pendiente" && (
                      <div className="mz-actions justify-content-end">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => revisar(r, true)}
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => revisar(r, false)}
                        >
                          Rechazar
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {registros.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={puedeAprobar ? 7 : 6}>No hay registros</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
