import { useEffect, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { usePermission } from "../../hooks/usePermission";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import "./Institucional.css";

function dias(n) {
  return `${n} ${n === 1 ? "día" : "días"}`;
}

/** Un período: cuántos días le corresponden, cuántos gozó y cuántos le
 * quedan, con la barra de avance y el detalle de lo gozado. */
function Periodo({ periodo }) {
  const avance = periodo.correspondientes
    ? Math.min(100, (periodo.gozados / periodo.correspondientes) * 100)
    : 0;
  const completo = periodo.pendientes === 0;
  return (
    <section
      className={`vacaciones-periodo${completo ? " vacaciones-periodo--completo" : ""}`}
      aria-label={`Período ${periodo.nombre}`}
    >
      <header className="vacaciones-periodo__cabecera">
        <div>
          <strong>Período {periodo.nombre}</strong>
          <small>
            Del {formatearFecha(periodo.desde)} al{" "}
            {formatearFecha(periodo.hasta)}
          </small>
        </div>
        <span
          className={`mz-pill ${completo ? "mz-pill--ok" : "mz-pill--warn"}`}
        >
          {completo
            ? "Gozado completo"
            : `${dias(periodo.pendientes)} pendientes`}
        </span>
      </header>

      <dl className="vacaciones-periodo__cifras">
        <div>
          <dt>Corresponden</dt>
          <dd>{periodo.correspondientes}</dd>
        </div>
        <div>
          <dt>Gozados</dt>
          <dd>{periodo.gozados}</dd>
        </div>
        <div>
          <dt>Pendientes</dt>
          <dd className="vacaciones-periodo__pendientes">
            {periodo.pendientes}
          </dd>
        </div>
      </dl>
      <div
        className="vacaciones-barra"
        role="progressbar"
        aria-label={`Gozados del período ${periodo.nombre}`}
        aria-valuemin={0}
        aria-valuemax={periodo.correspondientes}
        aria-valuenow={periodo.gozados}
      >
        <span style={{ width: `${avance}%` }} />
      </div>

      {periodo.goces.length > 0 ? (
        <div className="vacaciones-goces-marco">
          <table className="mz-table vacaciones-goces">
            <thead>
              <tr>
                <th>Gozadas del</th>
                <th>Al</th>
                <th className="num">Días</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {periodo.goces.map((g) => (
                <tr key={g.id}>
                  <td>{formatearFecha(g.desde)}</td>
                  <td>{formatearFecha(g.hasta)}</td>
                  <td className="num">{g.dias}</td>
                  <td className="mz-small">{g.descripcion || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mz-faint mz-small mb-0">
          Todavía no ha gozado días de este período.
        </p>
      )}
      {periodo.nota && (
        <p className="mz-small mz-faint mb-0">
          <Icon name="info-circle" /> {periodo.nota}
        </p>
      )}
    </section>
  );
}

/** El resumen y los períodos de una persona. */
function Vacaciones({ datos }) {
  if (datos.periodos.length === 0) {
    return (
      <div className="mz-card">
        <div className="mz-card-body mz-empty">
          <Icon name="sun" />
          <p>Todavía no hay períodos de vacaciones cargados.</p>
        </div>
      </div>
    );
  }
  // Solo los períodos con días pendientes (los gozados por completo se
  // ocultan), del más reciente al más antiguo.
  const periodos = datos.periodos.filter((p) => p.pendientes > 0).reverse();
  const gozadosCompletos = datos.periodos.length - periodos.length;
  return (
    <>
      <div className="vacaciones-resumen">
        <div className="vacaciones-resumen__principal">
          <span>Días pendientes de gozar</span>
          <strong>{datos.pendientes}</strong>
          <small>
            {datos.periodos_con_pendientes === 0
              ? "No tiene días pendientes."
              : `En ${datos.periodos_con_pendientes} ${
                  datos.periodos_con_pendientes === 1 ? "período" : "períodos"
                }`}
          </small>
        </div>
        <div>
          <span>Días gozados</span>
          <strong>{datos.gozados}</strong>
        </div>
        <div>
          <span>Días que corresponden</span>
          <strong>{datos.correspondientes}</strong>
          <small>
            {datos.periodos.length}{" "}
            {datos.periodos.length === 1 ? "período" : "períodos"}
          </small>
        </div>
      </div>
      {periodos.length === 0 ? (
        <div className="mz-card">
          <div className="mz-card-body mz-empty">
            <Icon name="check-circle" />
            <p>No tiene días pendientes: todos sus períodos están gozados.</p>
          </div>
        </div>
      ) : (
        <div className="vacaciones-periodos">
          {periodos.map((p) => (
            <Periodo key={p.id} periodo={p} />
          ))}
        </div>
      )}
      {gozadosCompletos > 0 && periodos.length > 0 && (
        <p className="mz-faint mz-small mb-0">
          <Icon name="info-circle" />{" "}
          {gozadosCompletos === 1
            ? "1 período ya gozado por completo no se muestra."
            : `${gozadosCompletos} períodos ya gozados por completo no se muestran.`}
        </p>
      )}
    </>
  );
}

/**
 * Institucional → Mis vacaciones: los días de vacaciones pendientes de gozar,
 * y por cada período (año de servicio) cuántos le corresponden, cuántos gozó y
 * cuántos le quedan. Quien tiene `vacaciones.ver_todas` puede consultar los
 * de cualquier persona de la empresa.
 */
export function MisVacacionesPage() {
  const verTodas = usePermission("vacaciones.ver_todas");
  const [mias, setMias] = useState(null);
  const [personas, setPersonas] = useState(null);
  const [buscar, setBuscar] = useState("");
  const [otra, setOtra] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    institucionalService
      .misVacaciones()
      .then(setMias)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar sus vacaciones.")),
      );
  }, []);

  useEffect(() => {
    if (!verTodas) return undefined;
    const espera = setTimeout(
      () =>
        institucionalService
          .personasVacaciones(buscar)
          .then(setPersonas)
          .catch(() => setPersonas([])),
      250,
    );
    return () => clearTimeout(espera);
  }, [verTodas, buscar]);

  async function verDe(persona) {
    setError(null);
    try {
      setOtra(await institucionalService.vacacionesDe(persona.id));
    } catch (err) {
      setError(mensajeDeError(err, "No se pudieron cargar sus vacaciones."));
    }
  }

  const mostradas = otra ?? mias;

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>
            {otra ? `Vacaciones de ${otra.persona.nombre}` : "Mis vacaciones"}
          </h2>
          <p className="mz-desc">
            Los días de vacaciones pendientes de gozar y, por cada período,
            cuántos corresponden, cuántos se gozaron y cuántos quedan.
          </p>
        </div>
        {otra && (
          <div className="mz-actions">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setOtra(null)}
            >
              <Icon name="arrow-left" /> Volver a las mías
            </button>
          </div>
        )}
      </div>

      {verTodas && (
        <details className="mz-card vacaciones-consulta">
          <summary>
            <Icon name="people" /> Consultar las vacaciones de otra persona
          </summary>
          <div className="mz-card-body">
            <input
              type="search"
              className="form-control form-control-sm mb-2"
              placeholder="Buscar por nombre o correo"
              aria-label="Buscar persona"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
            <ul className="vacaciones-personas">
              {(personas ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="vacaciones-personas__boton"
                    onClick={() => verDe(p)}
                  >
                    <span>{p.nombre}</span>
                    <span className="mz-faint mz-small">
                      {p.periodos === 0
                        ? "Sin períodos"
                        : `${dias(p.pendientes)} pendientes`}
                    </span>
                  </button>
                </li>
              ))}
              {personas?.length === 0 && (
                <li className="mz-faint mz-small">Nadie coincide.</li>
              )}
            </ul>
          </div>
        </details>
      )}

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {mostradas && <Vacaciones datos={mostradas} />}
    </div>
  );
}
