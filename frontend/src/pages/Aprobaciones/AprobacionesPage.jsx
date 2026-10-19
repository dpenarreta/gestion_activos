import { useCallback, useEffect, useState } from "react";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import "../Soporte/Soporte.css";

/**
 * Las solicitudes que esperan el visto bueno de quien entra (jefe de área,
 * Talento Humano…). El correo trae aquí: se aprueba con la cuenta, no desde
 * un enlace suelto. No hace falta ningún permiso de la mesa de ayuda; basta
 * con ser el aprobador. Quien coordina ve además las que no tienen aprobador.
 */
export function AprobacionesPage() {
  const [pendientes, setPendientes] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(() => {
    soporteService
      .aprobaciones()
      .then(setPendientes)
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudieron cargar las aprobaciones."),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function decidir(aprobacion, aprobar, nota) {
    setError(null);
    setAviso(null);
    try {
      await soporteService.decidirAprobacion(aprobacion.id, aprobar, nota);
      setAviso(
        aprobar
          ? `${aprobacion.ticket.numero} aprobado: entra a la cola de soporte.`
          : `${aprobacion.ticket.numero} no aprobado: se le avisó a quien lo pidió.`,
      );
      cargar();
      return true;
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo registrar la decisión."));
      return false;
    }
  }

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Aprobaciones</h2>
          <p className="mz-desc">
            Solicitudes de soporte que necesitan su visto bueno. Mientras no las
            apruebe, no entran a la cola.
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
      {pendientes?.length === 0 && (
        <div className="mz-empty">
          <Icon name="check2-all" /> No tiene aprobaciones pendientes.
        </div>
      )}
      {(pendientes ?? []).map((a) => (
        <TarjetaAprobacion key={a.id} aprobacion={a} onDecidir={decidir} />
      ))}
    </div>
  );
}

function TarjetaAprobacion({ aprobacion, onDecidir }) {
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const { ticket } = aprobacion;

  async function decidir(aprobar) {
    setEnviando(true);
    await onDecidir(aprobacion, aprobar, nota);
    setEnviando(false);
  }

  return (
    <section className="mz-card" aria-label={`Aprobación de ${ticket.numero}`}>
      <div className="mz-card-head">
        <h3>
          <span className="mz-mono">{ticket.numero}</span> ·{" "}
          {ticket.codigo && <span className="mz-mono">{ticket.codigo} </span>}
          {ticket.caso}
        </h3>
        <span className="mz-small mz-faint">
          {aprobacion.rol}
          {aprobacion.sin_aprobador && " · sin responsable con cuenta"} ·{" "}
          {formatearFecha(aprobacion.creada, true)}
        </span>
      </div>
      <div className="mz-card-body">
        <div className="mz-kv-grid mb-2">
          <div className="mz-kv">
            <span className="mz-kv-label">Pide</span>
            {ticket.solicitante} · {ticket.correo}
          </div>
          {ticket.area && (
            <div className="mz-kv">
              <span className="mz-kv-label">Área</span>
              {ticket.area}
            </div>
          )}
          {ticket.agencia && (
            <div className="mz-kv">
              <span className="mz-kv-label">Agencia</span>
              {ticket.agencia}
            </div>
          )}
          <div className="mz-kv">
            <span className="mz-kv-label">Prioridad</span>
            {ticket.prioridad_display}
          </div>
          {ticket.datos_adicionales.map((d) => (
            <div className="mz-kv" key={d.clave}>
              <span className="mz-kv-label">{d.etiqueta}</span>
              {d.valor}
            </div>
          ))}
        </div>
        <p className="soporte-publico__descripcion">{ticket.descripcion}</p>
        <label className="form-label" htmlFor={`ap-nota-${aprobacion.id}`}>
          Nota (obligatoria si no aprueba)
        </label>
        <textarea
          id={`ap-nota-${aprobacion.id}`}
          className="form-control form-control-sm"
          rows={2}
          maxLength={500}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />
        <div className="mz-actions justify-content-end mt-2">
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            disabled={enviando}
            onClick={() => decidir(false)}
          >
            No aprobar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={enviando}
            onClick={() => decidir(true)}
          >
            Aprobar
          </button>
        </div>
      </div>
    </section>
  );
}
