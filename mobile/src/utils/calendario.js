/**
 * La cuadrícula de un mes, sin pantalla (US-030, 17/11/2026): lo que comparten
 * el calendario de Inicio (`CalendarioInicio`), el de la Matriz
 * (`CalendarioMatriz`, que solo toma `moverMes`: su cuadrícula va de domingo a
 * sábado, como la web de la Matriz) y el de elegir el período de un permiso
 * (`CalendarioDeRango`). Antes `moverMes` estaba copiado en dos sitios y la
 * cuadrícula de lunes a domingo vivía solo en `inicio/calendario.js`, que la
 * sigue reexportando.
 *
 * Todo trabaja con «AAAA-MM-DD» y en UTC: un día es un día, sin que la zona
 * del teléfono lo mueva (en Ecuador, `new Date("2026-11-12")` es el 11 por la
 * noche).
 */

/** Los meses en minúscula, para armar fechas dichas («17 de noviembre»). */
export const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const DIAS_LARGOS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

/** De lunes a domingo, como el calendario de Inicio de la web. */
export const DIAS_DE_LA_SEMANA = [
  { corto: "Lun", largo: "lunes" },
  { corto: "Mar", largo: "martes" },
  { corto: "Mié", largo: "miércoles" },
  { corto: "Jue", largo: "jueves" },
  { corto: "Vie", largo: "viernes" },
  { corto: "Sáb", largo: "sábado" },
  { corto: "Dom", largo: "domingo" },
];

const dos = (n) => String(n).padStart(2, "0");

// `isoUtc` y `deIsoUtc` trabajan en UTC; no confundir con `aIso`/`deIso` de
// `utils/fechas.js`, que usan la hora local del teléfono.
function isoUtc(fecha) {
  return `${fecha.getUTCFullYear()}-${dos(fecha.getUTCMonth() + 1)}-${dos(fecha.getUTCDate())}`;
}

function deIsoUtc(iso) {
  const [a, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

/** Si «AAAA-MM-DD» es un día que existe. */
export function esIsoValido(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? "")) return false;
  return isoUtc(deIsoUtc(iso)) === iso;
}

/** «AAAA-MM-DD» más (o menos) `n` días. */
export function sumarDias(iso, n) {
  const fecha = deIsoUtc(iso);
  fecha.setUTCDate(fecha.getUTCDate() + n);
  return isoUtc(fecha);
}

/** El mes anterior o el siguiente. */
export function moverMes({ anio, mes }, delta) {
  const total = anio * 12 + (mes - 1) + delta;
  return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
}

/** `{ anio, mes }` de «AAAA-MM-DD», o `null` si no es una fecha. */
export function mesDe(iso) {
  if (!esIsoValido(iso)) return null;
  return { anio: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)) };
}

/** «AAAA-MM» de un mes, para comparar meses como texto. */
export function claveDelMes({ anio, mes }) {
  return `${anio}-${dos(mes)}`;
}

/** Los 42 días (6 semanas, desde el lunes) que se dibujan para un mes, con
 * `finDeSemana` ya calculado (sábado y domingo, las dos últimas columnas). */
export function diasDeLaCuadricula(anio, mes) {
  const primero = new Date(Date.UTC(anio, mes - 1, 1));
  const corrimiento = (primero.getUTCDay() + 6) % 7; // lunes = 0
  const inicio = isoUtc(new Date(Date.UTC(anio, mes - 1, 1 - corrimiento)));
  return Array.from({ length: 42 }, (_, i) => {
    const iso = sumarDias(inicio, i);
    return {
      iso,
      numero: Number(iso.slice(8)),
      delMes: Number(iso.slice(5, 7)) === mes,
      finDeSemana: i % 7 >= 5,
    };
  });
}

/** Las semanas de la cuadrícula que tienen algún día del mes (de 4 a 6): las
 * del todo ajenas al mes no se dibujan. */
export function semanasDeLaCuadricula(anio, mes) {
  const dias = diasDeLaCuadricula(anio, mes);
  const semanas = [];
  for (let i = 0; i < dias.length; i += 7) {
    const semana = dias.slice(i, i + 7);
    if (semana.some((d) => d.delMes)) semanas.push(semana);
  }
  return semanas;
}

/** «Noviembre 2026». */
export function tituloDelMes(anio, mes) {
  return `${MESES[mes - 1].charAt(0).toUpperCase()}${MESES[mes - 1].slice(1)} ${anio}`;
}

/** «lunes 16 de noviembre». */
export function diaConNombre(iso) {
  const fecha = deIsoUtc(iso);
  return `${DIAS_LARGOS[fecha.getUTCDay()]} ${fecha.getUTCDate()} de ${MESES[fecha.getUTCMonth()]}`;
}

/** «Martes 18 de noviembre de 2026»: el nombre completo de un día, para el
 * lector de pantalla (US-030, CA-7). */
export function diaCompleto(iso) {
  if (!esIsoValido(iso)) return "";
  const texto = `${diaConNombre(iso)} de ${iso.slice(0, 4)}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Sábado o domingo. */
export function esFinDeSemana(iso) {
  const dia = deIsoUtc(iso).getUTCDay();
  return dia === 0 || dia === 6;
}

/**
 * Cuántos días de calendario van de `desde` a `hasta`, los dos incluidos: 1
 * si son el mismo día. `null` si falta alguno, no es una fecha o `hasta` es
 * anterior. Lo usan el resumen de «Nueva solicitud» y el calendario de rango,
 * para que digan siempre el mismo número (US-030, CA-4). Los días que cuentan
 * (laborables, feriados) los dice el servidor.
 */
export function diasDeCalendario(desde, hasta) {
  if (!esIsoValido(desde) || !esIsoValido(hasta) || hasta < desde) return null;
  return Math.round((deIsoUtc(hasta) - deIsoUtc(desde)) / 86400000) + 1;
}
