/*
 * Repositorio mensual: los períodos 23 → 22 con el estado de cada equipo, el
 * resumen guardado al cerrar y las correcciones posteriores al cierre. Con
 * alcance nacional, además, el avance del cierre del período elegido.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { RUTA_GESTION_HUMANA } from "../../modulos/permisosGestionHumana";
import { ESTADO_PERIODO, TONO_PERIODO, fecha, fechaHora } from "./comunes";
import {
  BarraDeAlcance,
  ConAcceso,
  Encabezado,
  useNovedades,
} from "./ContextoNovedades";

const CAMPO = {
  hours: "horas",
  overtime_hours: "horas extras",
  saturday_hours: "horas de sábado",
  is_saturday: "sábado",
  is_sunday: "domingo",
  is_holiday: "feriado",
  work_done: "trabajo realizado",
  observations: "observaciones",
  deleted: "anulado",
};

/** `{hours: "8"}` → «horas: 8». */
function legible(valores) {
  if (!valores || typeof valores !== "object") return "—";
  const partes = Object.entries(valores)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(
      ([k, v]) =>
        `${CAMPO[k] ?? k}: ${v === true ? "sí" : v === false ? "no" : v}`,
    );
  return partes.length ? partes.join(", ") : "vacío";
}

export function RepositorioMensual() {
  return (
    <ConAcceso titulo="Repositorio mensual">
      <PantallaRepositorio />
    </ConAcceso>
  );
}

function PantallaRepositorio() {
  const { me, periodo, abrirPeriodo } = useNovedades();
  const navegar = useNavigate();
  const [periodos, setPeriodos] = useState(null);
  const [error, setError] = useState(null);
  const [avance, setAvance] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    setPeriodos(null);
    try {
      setPeriodos(await novedadesService.repositorio());
    } catch (err) {
      setPeriodos([]);
      setError(
        errorDeNovedades(err, "No se pudo cargar el repositorio.").mensaje,
      );
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!me.national_read || !periodo) return undefined;
    let vigente = true;
    novedadesService
      .estadoDePeriodos(periodo)
      .then((datos) => vigente && setAvance(datos))
      .catch(() => vigente && setAvance(null));
    return () => {
      vigente = false;
    };
  }, [me.national_read, periodo]);

  async function verRegistros(codigo, supervisorId) {
    if (await abrirPeriodo(codigo, supervisorId)) {
      navegar(`${RUTA_GESTION_HUMANA}/dias-laborados`);
    }
  }

  const cerrados = avance?.filter((s) => s.status === "CLOSED").length ?? 0;

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Repositorio mensual"
        descripcion="Los períodos del 23 al 22 con el cierre de cada equipo y las correcciones posteriores."
      />
      {me.national_read && (
        <BarraDeAlcance tipo="periodo" todos={false} idBase="gh-repo" />
      )}
      {avance && (
        <section className="mz-card" aria-labelledby="gh-repo-avance">
          <div className="mz-card-body">
            <h3 id="gh-repo-avance" className="h6">
              Avance del cierre nacional: {cerrados} de {avance.length}{" "}
              supervisores cerraron
            </h3>
            <div
              className="gh-avance mb-3"
              role="progressbar"
              aria-label="Supervisores que cerraron el período"
              aria-valuemin={0}
              aria-valuemax={avance.length}
              aria-valuenow={cerrados}
            >
              <span
                style={{
                  width: `${avance.length ? (cerrados / avance.length) * 100 : 0}%`,
                }}
              />
            </div>
            <ul className="gh-switch-lista">
              {avance.map((s) => (
                <li key={s.supervisor_id}>
                  <div>
                    <strong>{s.supervisor_name}</strong>
                    <div className="mz-small mz-faint">
                      {s.collaborators} colaboradores
                      {s.closed_at
                        ? ` · cerrado el ${fechaHora(s.closed_at)} por ${s.closed_by}`
                        : ""}
                    </div>
                  </div>
                  <span
                    className={`mz-pill ${TONO_PERIODO[s.status] ?? "mz-pill--neutral"}`}
                  >
                    {ESTADO_PERIODO[s.status] ?? s.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      <EstadoDeCarga
        cargando={periodos === null && !error}
        error={error}
        onReintentar={cargar}
        vacio={periodos?.length === 0}
        textoVacio="Todavía no hay períodos registrados."
      />
      {(periodos ?? []).map((p) => (
        <section
          key={p.code}
          className="mz-card"
          aria-labelledby={`gh-repo-${p.code}`}
        >
          <div className="mz-card-body">
            <h3 id={`gh-repo-${p.code}`} className="h6 mb-0">
              {p.label}
            </h3>
            <p className="mz-small mz-faint">
              Del {fecha(p.start_date)} al {fecha(p.end_date)}
            </p>
            <ul className="gh-switch-lista">
              {p.supervisors.map((s) => (
                <li key={s.supervisor_id}>
                  <div>
                    <strong>{s.supervisor_name}</strong>{" "}
                    <span
                      className={`mz-pill ${TONO_PERIODO[s.status] ?? "mz-pill--neutral"}`}
                    >
                      {ESTADO_PERIODO[s.status] ?? s.status}
                    </span>
                    {s.closed_at && (
                      <span className="mz-small mz-faint">
                        {" "}
                        · {fechaHora(s.closed_at)} por {s.closed_by}
                      </span>
                    )}
                    {s.summary?.active_collaborators !== undefined && (
                      <div className="mz-small mz-faint">
                        {s.summary.active_collaborators} colaboradores ·{" "}
                        {s.summary.worked_hours} h laboradas ·{" "}
                        {s.summary.pending_cells} celda(s) pendiente(s) al
                        cerrar
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    aria-label={`Ver los registros de ${s.supervisor_name} en ${p.label}`}
                    onClick={() => verRegistros(p.code, s.supervisor_id)}
                  >
                    Ver registros
                  </button>
                </li>
              ))}
            </ul>
            {p.corrections.length > 0 && (
              <div className="mt-3">
                <h4 className="h6 mz-faint">
                  Correcciones posteriores al cierre
                </h4>
                <ul className="mz-timeline">
                  {p.corrections.map((c) => (
                    <li key={c.id} className="mz-tl-item">
                      <div className="mz-tl-what">
                        {c.target === "WORKED_DAY"
                          ? "Días laborados"
                          : "Horas extras"}{" "}
                        ({c.supervisor_name}): {legible(c.original_values)} →{" "}
                        <strong>{legible(c.new_values)}</strong>
                      </div>
                      <div className="mz-tl-when">
                        {fechaHora(c.created_at)} · {c.corrected_by}
                      </div>
                      <div className="mz-tl-why">Motivo: {c.reason}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
