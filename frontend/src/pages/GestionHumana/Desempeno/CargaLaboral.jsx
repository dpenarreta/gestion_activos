/*
 * Carga laboral (horas reales) de hoy, la semana y el mes, con sus rangos
 * y los gráficos del mes (`WorkloadCard` de Nexo).
 *
 * Datos de salud (LOPDP): el servidor enmascara el motivo de las ausencias
 * según quién consulta. Cuando lo hizo, el mes trae `ausencia_minutes` (y los
 * minutos por tipo en cero) y los días de permiso llegan como
 * `leave-generic`: aquí se muestra «Ausencia justificada» con sus horas, tal
 * cual llega. Nunca se intenta reconstruir el tipo. El estado especial
 * (maternidad, lactancia) solo aparece si el servidor lo envía.
 */
import { BarrasDeCargaDiaria, LineaDeCargaSemanal } from "./Graficos";
import { Estrellas, Semaforo } from "./Componentes";
import {
  ESTADO_ESPECIAL,
  duracionDeMinutos,
  horas,
  madurezPorCantidad,
  porcentaje,
  tonoDe,
} from "./kpiComunes";

/** Si el servidor enmascaró el motivo de las ausencias. */
export function ausenciasEnmascaradas(cargaTiempo) {
  return cargaTiempo?.mensual?.ausencia_minutes !== undefined;
}

/** Las líneas de la ausencia de hoy, si la hay. */
export function lineasDeAusenciaDelDia(diaria, enmascarado) {
  if (!diaria) return [];
  if (enmascarado) {
    if (diaria.personal_leave_full_day)
      return ["Ausencia justificada (día completo)"];
    if (diaria.personal_leave_minutes > 0)
      return [
        `Ausencia justificada (${duracionDeMinutos(diaria.personal_leave_minutes)})`,
      ];
    return [];
  }
  const lineas = [];
  if (diaria.vacaciones_full_day) lineas.push("Vacaciones");
  if (diaria.medico_leave_full_day)
    lineas.push("Permiso médico (día completo)");
  else if (diaria.medico_leave_minutes > 0)
    lineas.push(
      `Permiso médico (${duracionDeMinutos(diaria.medico_leave_minutes)})`,
    );
  if (diaria.personal_leave_full_day)
    lineas.push("Permiso personal (día completo)");
  else if (diaria.personal_leave_minutes > 0)
    lineas.push(
      `Permiso personal (${duracionDeMinutos(diaria.personal_leave_minutes)})`,
    );
  return lineas;
}

/** Las notas del mes: fines de semana, feriados y ausencias. */
export function notasDelMes(mensual, enmascarado) {
  if (!mensual) return [];
  const notas = [];
  if (mensual.weekend_hours > 0)
    notas.push(`Fines de semana: ${horas(mensual.weekend_hours)}`);
  if (mensual.holiday_hours > 0)
    notas.push(`Feriados trabajados: ${horas(mensual.holiday_hours)}`);
  if (enmascarado) {
    if (mensual.ausencia_minutes > 0)
      notas.push(
        `Ausencias justificadas: ${duracionDeMinutos(mensual.ausencia_minutes)}`,
      );
    return notas;
  }
  if (mensual.medico_leave_minutes > 0)
    notas.push(
      `Permisos médicos: ${duracionDeMinutos(mensual.medico_leave_minutes)}`,
    );
  if (mensual.personal_leave_minutes > 0)
    notas.push(
      `Permisos personales: ${duracionDeMinutos(mensual.personal_leave_minutes)}`,
    );
  if (mensual.vacaciones_minutes > 0)
    notas.push(`Vacaciones: ${duracionDeMinutos(mensual.vacaciones_minutes)}`);
  return notas;
}

function especial(tipo) {
  return tipo
    ? `Jornada especial: ${ESTADO_ESPECIAL[tipo] ?? "estado especial"}`
    : null;
}

function Bloque({
  etiqueta,
  metrica,
  periodo,
  notas = [],
  ausencias = [],
  enCurso = false,
}) {
  const finDeSemana = metrica.is_weekend || metrica.is_holiday;
  // El día de hoy no se juzga antes de terminar: «En curso», sin semáforo.
  const tono = enCurso ? "neutral" : tonoDe(metrica.color);
  return (
    <div
      className={`gk-bloque gk-bloque--${finDeSemana || ausencias.length ? "info" : tono}`}
    >
      <p className="gk-bloque__etiqueta">{etiqueta}</p>
      {finDeSemana ? (
        <p className="gk-bloque__valor">
          {horas(metrica.real_hours)}{" "}
          <Semaforo tono="info">
            Trabajo en {metrica.is_holiday ? "feriado" : "fin de semana"}
          </Semaforo>
        </p>
      ) : ausencias.length ? (
        ausencias.map((a) => (
          <p key={a} className="gk-bloque__valor">
            {a}
          </p>
        ))
      ) : (
        <>
          <p className="gk-bloque__valor">
            {horas(metrica.real_hours)}{" "}
            <Semaforo tono={tono}>
              {enCurso ? "En curso" : metrica.label}
            </Semaforo>
          </p>
          <p className="mz-small mb-0">
            {metrica.base_hours > 0
              ? `Rango óptimo: ${horas(metrica.range_min)} a ${horas(metrica.range_max)} · ${porcentaje(metrica.pct)}`
              : porcentaje(metrica.pct)}
          </p>
        </>
      )}
      {notas.filter(Boolean).map((n) => (
        <p key={n} className="mz-small gk-bloque__nota mb-0">
          {n}
        </p>
      ))}
      <p className="mz-small mz-faint mb-0">{periodo}</p>
    </div>
  );
}

export function CargaLaboral({ cargaTiempo }) {
  if (!cargaTiempo) return null;
  const {
    diaria,
    semanal,
    mensual,
    daily_history: diario = [],
    weekly_history: semanas = [],
  } = cargaTiempo;
  const enmascarado = ausenciasEnmascaradas(cargaTiempo);
  const diasConRegistro = diario.filter((d) => d.real_hours > 0).length;
  const bajo = horas(cargaTiempo.effective_limit_low);
  const base = horas(cargaTiempo.effective_limit_base);
  const alto = horas(cargaTiempo.effective_limit_high);
  const sobre = horas(cargaTiempo.effective_limit_overload);

  return (
    <div className="mz-stack">
      <div className="gk-carga-cabeza">
        <span className="mz-small mz-faint">
          {horas(cargaTiempo.effective_hours_per_dia)} efectivas por día
        </span>
        <Estrellas
          nivel={madurezPorCantidad(diasConRegistro)}
          titulo={`Madurez del dato: ${diasConRegistro} días con registro`}
        />
        {diaria?.special_status_type && (
          <Semaforo tono="info">
            {especial(diaria.special_status_type)}
          </Semaforo>
        )}
      </div>
      <p className="mz-small mz-faint mb-0">
        Rangos por día: Subutilización bajo {bajo} · Moderado de {bajo} a {base}{" "}
        · Óptimo de {base} a {alto} · Carga elevada de {alto} a {sobre} ·
        Sobrecarga sobre {sobre}.
      </p>
      {cargaTiempo.kpi_start_date && (
        <p className="mz-small mb-0">
          KPI calculados desde el {cargaTiempo.kpi_start_date.slice(8, 10)}/
          {cargaTiempo.kpi_start_date.slice(5, 7)}/
          {cargaTiempo.kpi_start_date.slice(0, 4)} por configuración del
          administrador.
        </p>
      )}
      <div className="gk-bloques">
        <Bloque
          etiqueta="Hoy"
          metrica={diaria}
          periodo="hoy (se clasifica al cierre del día)"
          enCurso
          ausencias={lineasDeAusenciaDelDia(diaria, enmascarado)}
          notas={[especial(diaria.special_status_type)]}
        />
        <Bloque
          etiqueta="Esta semana"
          metrica={semanal}
          periodo={`semana del ${semanal.week_start_label} al ${semanal.week_end_label}`}
          notas={[
            especial(semanal.special_status_type),
            semanal.weekend_hours > 0 && semanal.real_hours > semanal.base_hours
              ? `Incluye ${horas(semanal.weekend_hours)} de fin de semana`
              : null,
          ]}
        />
        <Bloque
          etiqueta="Este mes"
          metrica={mensual}
          periodo={`${mensual.month_label}, ${mensual.business_days} ${mensual.business_days === 1 ? "día laborable" : "días laborables"}`}
          notas={[
            especial(mensual.special_status_type),
            ...notasDelMes(mensual, enmascarado),
          ]}
        />
      </div>
      <BarrasDeCargaDiaria
        puntos={diario}
        base={cargaTiempo.effective_hours_per_dia}
        limiteOptimo={cargaTiempo.effective_limit_high}
      />
      <LineaDeCargaSemanal
        puntos={semanas}
        limiteOptimo={(cargaTiempo.effective_limit_high ?? 0) * 5}
      />
    </div>
  );
}
