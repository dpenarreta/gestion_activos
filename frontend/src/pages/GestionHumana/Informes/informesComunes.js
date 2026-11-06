/*
 * Etiquetas, tonos y reglas de período de los informes ejecutivos. Los
 * límites son los del servidor (`apps.informes.serializers`): aquí solo se
 * adelantan para avisar antes de enviar; el servidor los vuelve a validar.
 */
import { RUTA_GESTION_HUMANA } from "../../../modulos/permisosGestionHumana";

export const RUTA_INFORMES = `${RUTA_GESTION_HUMANA}/informes`;
export const rutaDeInforme = (reportId) =>
  `${RUTA_INFORMES}/${encodeURIComponent(reportId)}`;

/** `ExecutiveReportSnapshot.Type`. */
export const TIPO = {
  MENSUAL: "Mensual",
  RANGO_MESES: "Rango de meses",
  RANGO_PERSONALIZADO: "Rango personalizado",
};
export const TIPOS = Object.keys(TIPO);

/** `ExecutiveReportSnapshot.PeriodStatus`. */
export const ESTADO_PERIODO = {
  EN_CURSO: "En curso",
  CERRADO: "Cerrado",
  HISTORICO: "Histórico",
};
export const ESTADOS_PERIODO = Object.keys(ESTADO_PERIODO);

/** Un período en curso todavía puede cambiar: se avisa en ámbar. */
export const TONO_ESTADO_PERIODO = {
  EN_CURSO: "warn",
  CERRADO: "ok",
  HISTORICO: "neutral",
};

/** `integrity_flag`: PARTIAL si el motor anotó incidentes al generarlo. */
export const INTEGRIDAD = {
  FULL: { texto: "Integridad completa", tono: "ok" },
  PARTIAL: { texto: "Integridad parcial", tono: "warn" },
};

/** `closure_type` del cierre de mes (Tareas). */
export const TIPO_CIERRE = {
  NORMAL: "cerrado al terminar el mes",
  EARLY: "cerrado anticipadamente",
  MANUAL: "cerrado con fecha de corte regularizada manualmente",
};

/** Los cuadrantes de la matriz de riesgo (`QUADRANT_LABEL` del servidor). */
export const CUADRANTE = {
  criticos: "Crítico",
  "atencion-carga": "Atención (carga)",
  "atencion-cumplimiento": "Atención (cumplimiento)",
  saludables: "Saludable",
};

/** Calidad del dato: ≥ 90 buena, ≥ 70 aceptable (los cortes de Desempeño). */
export const tonoDeCalidad = (pct) =>
  pct >= 90 ? "ok" : pct >= 70 ? "warn" : "bad";

export const MIN_MESES = 2;
export const MAX_MESES = 24;
export const MAX_DIAS = 366;

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** «AAAA-MM» del mes actual en Ecuador (la hora de la intranet). */
export function mesDeHoy(ahora = new Date()) {
  return diaDeHoy(ahora).slice(0, 7);
}

/** «AAAA-MM-DD» de hoy en Ecuador: a las 19:00 de Guayaquil `toISOString`
 * ya da el día siguiente. */
export function diaDeHoy(ahora = new Date()) {
  return ahora.toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
}

export function mesesEntre(desde, hasta) {
  const [y1, m1] = desde.split("-").map(Number);
  const [y2, m2] = hasta.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

export function diasEntre(desde, hasta) {
  // En UTC: un día de horario de verano no cambia la cuenta.
  const dia = (d) => Date.parse(`${d}T00:00:00Z`);
  return Math.round((dia(hasta) - dia(desde)) / 86400000);
}

/** El primer día del período, «AAAA-MM-DD», o null si aún no es válido. */
export function inicioDelPeriodo(valores) {
  if (valores.tipo === "MENSUAL")
    return MES.test(valores.mes) ? `${valores.mes}-01` : null;
  if (valores.tipo === "RANGO_MESES")
    return MES.test(valores.desdeMes) ? `${valores.desdeMes}-01` : null;
  return DIA.test(valores.desdeDia) ? valores.desdeDia : null;
}

/**
 * Lo que el servidor rechazaría, dicho antes de enviar: `{ campo: mensaje }`
 * con los mismos nombres de campo del cuerpo (`mes`, `desde`, `hasta`,
 * `fecha_corte`) para que los errores del servidor caigan en el mismo sitio.
 */
export function validarPeriodo(valores, ahora = new Date()) {
  const errores = {};
  const actual = mesDeHoy(ahora);
  const hoy = diaDeHoy(ahora);
  if (valores.tipo === "MENSUAL") {
    if (!MES.test(valores.mes ?? "")) errores.mes = "Elija el mes del informe.";
    else if (valores.mes > actual) errores.mes = "Ese mes todavía no empieza.";
  } else if (valores.tipo === "RANGO_MESES") {
    const { desdeMes: desde, hastaMes: hasta } = valores;
    if (!MES.test(desde ?? "")) errores.desde = "Elija el mes de inicio.";
    if (!MES.test(hasta ?? "")) errores.hasta = "Elija el mes de fin.";
    if (!errores.desde && !errores.hasta) {
      if (desde >= hasta)
        errores.desde = "El mes de inicio debe ser anterior al de fin.";
      else if (hasta > actual) errores.hasta = "Ese mes todavía no empieza.";
      else {
        const meses = mesesEntre(desde, hasta);
        if (meses < MIN_MESES || meses > MAX_MESES)
          errores.hasta = `El rango debe tener entre ${MIN_MESES} y ${MAX_MESES} meses.`;
      }
    }
  } else {
    const { desdeDia: desde, hastaDia: hasta } = valores;
    if (!DIA.test(desde ?? "")) errores.desde = "Elija la fecha de inicio.";
    if (!DIA.test(hasta ?? "")) errores.hasta = "Elija la fecha de fin.";
    if (!errores.desde && !errores.hasta) {
      if (desde > hasta)
        errores.desde =
          "La fecha de inicio debe ser anterior o igual a la de fin.";
      else if (diasEntre(desde, hasta) > MAX_DIAS)
        errores.hasta = `El rango no puede superar ${MAX_DIAS} días.`;
      else if (desde > hoy) errores.desde = "Ese día todavía no llega.";
    }
  }
  const inicio = inicioDelPeriodo(valores);
  if (valores.fechaCorte) {
    if (!DIA.test(valores.fechaCorte))
      errores.fecha_corte = "La fecha de corte no es válida.";
    else if (inicio && valores.fechaCorte < inicio)
      errores.fecha_corte =
        "La fecha de corte no puede ser anterior al inicio del período.";
  }
  return errores;
}

/**
 * El cuerpo de `POST executive/`. La fecha de corte se elige como un día y
 * se manda como el final de ese día en Ecuador: «hasta el 15» incluye todo
 * lo registrado el 15.
 */
export function cuerpoDelPedido(valores) {
  const cuerpo = {
    tipo: valores.tipo,
    roles: valores.roles,
    areas: valores.areas,
    colaboradores: valores.colaboradores,
  };
  if (valores.tipo === "MENSUAL") cuerpo.mes = valores.mes;
  else if (valores.tipo === "RANGO_MESES") {
    cuerpo.desde = valores.desdeMes;
    cuerpo.hasta = valores.hastaMes;
  } else {
    cuerpo.desde = valores.desdeDia;
    cuerpo.hasta = valores.hastaDia;
  }
  if (valores.fechaCorte)
    cuerpo.fecha_corte = `${valores.fechaCorte}T23:59:59-05:00`;
  return cuerpo;
}

/** «2026-10-31» (solo fecha, medianoche UTC) → «31 de octubre de 2026». */
export function fechaLargaUtc(iso) {
  if (!iso) return "—";
  const valor = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(valor.getTime())) return String(iso);
  return valor.toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Un valor de un incidente de integridad, legible (pueden venir objetos). */
export function valorLegible(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}
