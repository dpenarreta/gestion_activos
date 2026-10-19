import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import { NuevoTicket } from "./NuevoTicket";
import "../Soporte/Soporte.css";

/** Los tickets que pidió quien entra, lo más reciente primero. */
export function MisTickets() {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    soporteService
      .misTickets()
      .then(setTickets)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar sus tickets.")),
      );
  }, []);

  if (error) {
    return (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {error}
      </div>
    );
  }
  return (
    <div className="mz-table-wrap">
      <table className="mz-table">
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Caso</th>
            <th>Estado</th>
            <th>Creado</th>
          </tr>
        </thead>
        <tbody>
          {(tickets ?? []).map((t) => (
            <tr key={t.id}>
              <td>
                <Link to={`/admin/ayuda/tickets/${t.id}`} className="mz-mono">
                  {t.numero}
                </Link>
              </td>
              <td>
                {t.caso}
                <div className="mz-small mz-faint">{t.categoria}</div>
              </td>
              <td>
                <span className="mz-pill mz-pill--neutral">
                  {t.estado_display}
                </span>
                {t.posicion && (
                  <div className="mz-small mz-faint">
                    Posición en la cola: {t.posicion}
                  </div>
                )}
              </td>
              <td>{formatearFecha(t.creado, true)}</td>
            </tr>
          ))}
          {tickets?.length === 0 && (
            <tr className="mz-empty-row">
              <td colSpan={4}>Todavía no ha pedido soporte</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const PESTANAS = [
  ["nuevo", "Nuevo ticket"],
  ["mios", "Mis tickets"],
];

/**
 * «Soporte TI»: para toda persona con sesión, sin permisos. Pide soporte con
 * sus datos de «Mi perfil» y sigue sus tickets. (Desde el 20/10/2026 no hay
 * formulario público.)
 */
export function AyudaPage() {
  const [pestana, setPestana] = useState("nuevo");
  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Soporte TI</h2>
          <p className="mz-desc">
            Pida ayuda al equipo de tecnología y siga sus tickets.
          </p>
        </div>
      </div>
      <div className="mz-tabs" role="tablist">
        {PESTANAS.map(([id, texto]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pestana === id}
            className={pestana === id ? "is-active" : undefined}
            onClick={() => setPestana(id)}
          >
            {texto}
          </button>
        ))}
      </div>
      {pestana === "nuevo" ? <NuevoTicket /> : <MisTickets />}
    </div>
  );
}
