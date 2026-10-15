/**
 * Formato de fechas, horas y estados de la Matriz (§15): «2 oct. 2026»,
 * «5:00 p. m.», siempre en la zona horaria de la empresa —no en la del
 * navegador—, porque un vencimiento «a las 17:00» es a las 17:00 de donde se
 * cumple la obligación.
 */

const LOCALE = "es-EC";

export function fechaCorta(valor, zona) {
  if (!valor) return "—";
  return new Date(valor).toLocaleDateString(LOCALE, {
    timeZone: zona || undefined,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Una fecha sin hora (AAAA-MM-DD) tal cual, sin moverla de día. */
export function diaCorto(valor) {
  if (!valor) return "—";
  return new Date(`${valor}T12:00:00Z`).toLocaleDateString(LOCALE, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function horaCorta(valor, zona) {
  if (!valor) return "";
  return new Date(valor).toLocaleTimeString(LOCALE, {
    timeZone: zona || undefined,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fechaHora(valor, zona) {
  if (!valor) return "—";
  return `${fechaCorta(valor, zona)} · ${horaCorta(valor, zona)}`;
}

/** La píldora de cada grupo de estado (§9): rojo, tomate, verde. */
export const PILDORA_DEL_GRUPO = {
  incumplido: "mz-pill--bad",
  en_progreso: "mz-pill--warn",
  finalizado: "mz-pill--ok",
};

export const ICONO_DEL_GRUPO = {
  incumplido: "exclamation-triangle",
  en_progreso: "clock",
  finalizado: "check2",
};

/** La columna «Días» de la matriz (§15.3). */
export function textoDeDias(estado) {
  if (!estado) return { texto: "—", clase: "mz-faint" };
  if (estado.group === "incumplido") {
    return {
      texto: `+${estado.days_overdue} d atraso`,
      clase: "mz-bad mz-days",
    };
  }
  if (estado.group === "finalizado") {
    return estado.is_late
      ? {
          texto: `${estado.days_overdue} d atraso (cerrado)`,
          clase: "mz-faint",
        }
      : { texto: "—", clase: "mz-faint" };
  }
  if (estado.is_due_today)
    return { texto: "Vence hoy", clase: "mz-warn mz-days" };
  return { texto: `${estado.days_remaining} d restantes`, clase: "mz-info" };
}

export const PRIORIDADES = { alta: "Alta", media: "Media", baja: "Baja" };
