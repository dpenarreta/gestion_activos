import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { Campo } from "../../components/common/Campo/Campo";
import { confirmar } from "../../components/common/Confirmar/confirmar";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { useVistaDeTarjetas } from "../../hooks/useMediaQuery";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import "./Soporte.css";

const TONO = {
  pendiente: "mz-pill--warn",
  aprobado: "mz-pill--ok",
  rechazado: "mz-pill--bad",
};

const VACIO = {
  pendiente: "No hay horas por revisar.",
  aprobado: "No hay horas aprobadas.",
  rechazado: "No hay horas rechazadas.",
  "": "No hay horas registradas.",
};

function horas(n) {
  const valor = Number(n);
  return `${valor} ${valor === 1 ? "hora" : "horas"}`;
}

/**
 * Horas fuera de horario: cada técnico ve las que registró; quien supervisa
 * las ve todas y las aprueba o rechaza.
 *
 * Auditoría UX/UI (30/10/2026): aprobar se confirma diciendo cuánto y de
 * quién; rechazar pide el motivo (afecta el pago y antes era un clic); los
 * botones esperan mientras se guarda y el resultado se dice. Con «Cargando…»
 * y tarjetas en el teléfono.
 */
export function HorasFuera() {
  const [registros, setRegistros] = useState(null);
  const [estado, setEstado] = useState("pendiente");
  const [puedeAprobar, setPuedeAprobar] = useState(false);
  const [error, setError] = useState(null);
  // El fallo de aprobar o rechazar no es un fallo de carga: no reemplaza la
  // tabla y, con el diálogo abierto, sale dentro de él.
  const [errorAccion, setErrorAccion] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [revisando, setRevisando] = useState(null);
  const [rechazando, setRechazando] = useState(null);
  const enTarjetas = useVistaDeTarjetas();

  const cargar = useCallback(() => {
    setError(null);
    setRegistros(null);
    soporteService
      .horas({ estado })
      .then((datos) => setRegistros(datos.results ?? datos))
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar las horas.")),
      );
  }, [estado]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    soporteService
      .bandeja()
      .then((b) => setPuedeAprobar(b.puede.aprobar_horas))
      .catch(() => setPuedeAprobar(false));
  }, []);

  async function revisar(registro, aprobar, nota = "") {
    setAviso(null);
    setErrorAccion(null);
    setRevisando(registro.id);
    try {
      await soporteService.revisarHoras(registro.id, aprobar, nota);
      setAviso(
        `${aprobar ? "Aprobadas" : "Rechazadas"} ${horas(registro.horas)} de ${registro.tecnico_nombre}.`,
      );
      cargar();
      return true;
    } catch (err) {
      setErrorAccion(mensajeDeError(err, "No se pudo revisar el registro."));
      return false;
    } finally {
      setRevisando(null);
    }
  }

  async function aprobar(registro) {
    const si = await confirmar({
      titulo: `¿Aprobar ${horas(registro.horas)} de ${registro.tecnico_nombre}?`,
      mensaje: `Del ${formatearFecha(registro.fecha)}, en el ticket ${registro.ticket_numero}: «${registro.descripcion}».`,
      accion: "Aprobar",
      peligro: false,
    });
    if (si) revisar(registro, true);
  }

  function acciones(r) {
    if (!puedeAprobar || r.estado !== "pendiente") return null;
    const ocupado = revisando === r.id;
    return (
      <div className="mz-actions justify-content-end">
        <button
          type="button"
          className="btn btn-sm btn-outline-primary"
          disabled={ocupado}
          aria-label={`Aprobar ${horas(r.horas)} de ${r.tecnico_nombre}`}
          onClick={() => aprobar(r)}
        >
          {ocupado ? "Guardando…" : "Aprobar"}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-danger"
          disabled={ocupado}
          aria-label={`Rechazar ${horas(r.horas)} de ${r.tecnico_nombre}`}
          onClick={() => setRechazando(r)}
        >
          Rechazar
        </button>
      </div>
    );
  }

  const estadoDeCarga = {
    cargando: registros === null && !error,
    error,
    onReintentar: cargar,
    vacio: registros?.length === 0,
    textoVacio: VACIO[estado],
    accionVacio:
      estado === "pendiente" && !puedeAprobar ? (
        <span className="mz-small mz-faint">
          Se registran desde el ticket cuando lo trabaja fuera de su horario.
        </span>
      ) : undefined,
  };

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
      {errorAccion && !rechazando && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {errorAccion}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check2-circle" />
          {aviso}
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
      <div className="mz-table-wrap mz-table-wrap--con-tarjetas">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Técnico</th>
              <th>Ticket</th>
              <th className="num">Horas</th>
              <th>Qué hizo</th>
              <th>Estado</th>
              {puedeAprobar && (
                <th>
                  <span className="visually-hidden">Acciones</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {(registros ?? []).map((r) => (
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
                {puedeAprobar && <td className="num">{acciones(r)}</td>}
              </tr>
            ))}
            <FilaDeEstado columnas={puedeAprobar ? 7 : 6} {...estadoDeCarga} />
          </tbody>
        </table>
      </div>
      {enTarjetas && (
        <div className="mz-cards">
          <EstadoDeCarga {...estadoDeCarga} />
          {registros?.length > 0 && (
            <ul className="mz-cards-lista" aria-label="Horas fuera de horario">
              {registros.map((r) => (
                <li key={r.id} className="mz-card-row">
                  <div className="mz-row-between">
                    <strong>{r.tecnico_nombre}</strong>
                    <span className={`mz-pill ${TONO[r.estado]}`}>
                      {r.estado_display}
                    </span>
                  </div>
                  <div className="mz-card-row__titulo">{r.descripcion}</div>
                  <div className="mz-card-meta">
                    <span>{formatearFecha(r.fecha)}</span>
                    <span>{horas(r.horas)}</span>
                    <Link to={`/admin/soporte/tickets/${r.ticket}`}>
                      {r.ticket_numero}
                    </Link>
                  </div>
                  {acciones(r) && (
                    <div className="mz-card-acciones">{acciones(r)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {rechazando && (
        <Rechazar
          registro={rechazando}
          errorServidor={errorAccion}
          onCerrar={() => {
            setRechazando(null);
            setErrorAccion(null);
          }}
          onRechazar={async (motivo) => {
            if (await revisar(rechazando, false, motivo)) setRechazando(null);
          }}
        />
      )}
    </div>
  );
}

/** Rechazar pide el motivo: lo ve el técnico. */
function Rechazar({ registro, errorServidor, onCerrar, onRechazar }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const caja = useRef(null);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });

  async function enviar(evento) {
    evento.preventDefault();
    if (!motivo.trim()) {
      setError("Escriba el motivo: el técnico lo verá.");
      caja.current?.focus();
      return;
    }
    setGuardando(true);
    await onRechazar(motivo.trim());
    setGuardando(false);
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hf-rechazar-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="hf-rechazar-titulo">
            Rechazar {horas(registro.horas)} de {registro.tecnico_nombre}
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
        <form className="mz-panel-body" onSubmit={enviar} noValidate>
          <p>
            Del {formatearFecha(registro.fecha)}, en el ticket{" "}
            {registro.ticket_numero}: «{registro.descripcion}».
          </p>
          <Campo
            id="hf-motivo"
            etiqueta="Motivo del rechazo"
            obligatorio
            ayuda="Lo ve el técnico."
            error={error}
            className="mb-3"
          >
            <textarea
              ref={caja}
              className="form-control form-control-sm"
              rows={3}
              maxLength={500}
              value={motivo}
              data-autofocus
              onChange={(e) => {
                setMotivo(e.target.value);
                if (error && e.target.value.trim()) setError(null);
              }}
            />
          </Campo>
          {errorServidor && (
            <div className="mz-alert mz-alert--bad mb-3" role="alert">
              <Icon name="x-octagon" />
              {errorServidor}
            </div>
          )}
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-danger btn-sm"
              disabled={guardando}
            >
              {guardando ? "Guardando…" : "Rechazar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
