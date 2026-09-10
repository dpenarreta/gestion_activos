/**
 * Formateo de fechas y montos para la interfaz.
 *
 * Se fija la configuración regional a es-EC (el sistema es de una empresa
 * ecuatoriana) en lugar de usar la del navegador: en un inventario que varias
 * personas revisan y comparan, la misma fecha debe leerse igual en todas las
 * pantallas, y `undefined` como locale haría que un navegador en inglés
 * mostrara 3/15/2024 junto a 15/3/2024 de otro.
 */
const LOCALE = "es-EC";
const MONEDA = "USD";

export function formatearFecha(valor, conHora = false) {
  if (!valor) return "—";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return String(valor);

  // Una fecha sin hora (YYYY-MM-DD) se interpreta como UTC y, en husos
  // negativos como el de Ecuador, retrocedería un día al formatearla en
  // local. Se fuerza UTC para que el día mostrado sea el capturado.
  const soloFecha = typeof valor === "string" && valor.length === 10;
  return fecha.toLocaleString(LOCALE, {
    timeZone: soloFecha ? "UTC" : undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(conHora ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

export function formatearMoneda(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  const numero = Number(valor);
  if (Number.isNaN(numero)) return String(valor);
  return numero.toLocaleString(LOCALE, { style: "currency", currency: MONEDA });
}

const DIAS_POR_MES = 30;
const MESES_POR_ANIO = 12;

function _plural(cantidad, singular, plural) {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

/** «1 año, 2 meses y 5 días»: coma entre las primeras, «y» antes de la última. */
function _enumerar(partes) {
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}

/**
 * Una duración en días, contada como la lee una persona.
 *
 * Hasta 30 días se dicen en días, porque es la unidad en la que se decide algo
 * esta semana. A partir de ahí «412 días» obliga a dividir mentalmente para
 * saber si es mucho o poco, así que se pasa a meses y, cuando el equipo lleva
 * más de un año, a años: «1 año, 1 mes y 22 días».
 *
 * Los días nunca se pierden por el camino. Es lo que hacía dudar de mostrarlo
 * en meses —«11 meses» redondea justo la diferencia que importa al comparar dos
 * equipos—, y con el resto delante esa objeción desaparece.
 *
 * El mes vale 30 días y el año 12 de esos meses. No es el calendario, y no
 * puede serlo: aquí llega un número de días, no dos fechas entre las que
 * contar. Fijar el mes en 30 mantiene la cuenta coherente con el propio umbral
 * de la regla —lo que pasa de 30 días ya es un mes— en vez de que «1 mes»
 * signifique una cosa en febrero y otra en marzo.
 *
 * El signo es asunto de quien llama: una garantía vencida se dice «venció hace
 * 2 meses», no «hace -2 meses».
 */
export function formatearDias(dias) {
  if (dias === null || dias === undefined || dias === "") return "—";
  const total = Number(dias);
  if (Number.isNaN(total)) return String(dias);

  const absoluto = Math.abs(Math.trunc(total));
  if (absoluto <= DIAS_POR_MES) return _plural(absoluto, "día", "días");

  const mesesTotales = Math.floor(absoluto / DIAS_POR_MES);
  const resto = absoluto % DIAS_POR_MES;
  const partes = [];

  if (mesesTotales >= MESES_POR_ANIO) {
    const anios = Math.floor(mesesTotales / MESES_POR_ANIO);
    const meses = mesesTotales % MESES_POR_ANIO;
    partes.push(_plural(anios, "año", "años"));
    if (meses > 0) partes.push(_plural(meses, "mes", "meses"));
  } else {
    partes.push(_plural(mesesTotales, "mes", "meses"));
  }
  // Un cero no aporta: «2 meses» se lee mejor que «2 meses y 0 días».
  if (resto > 0) partes.push(_plural(resto, "día", "días"));

  return _enumerar(partes);
}

/**
 * Una antigüedad en meses, con la misma regla que los días.
 *
 * Un equipo de «70 meses» obliga a dividir para saber que lleva casi seis años.
 * Pasado el año se dice en años, y los meses sobrantes se conservan por lo
 * mismo que los días: «5 años» y «5 años y 10 meses» son decisiones distintas
 * cuando la política de renovación mira los seis.
 */
export function formatearMeses(meses) {
  if (meses === null || meses === undefined || meses === "") return "—";
  const total = Number(meses);
  if (Number.isNaN(total)) return String(meses);

  const absoluto = Math.abs(Math.trunc(total));
  if (absoluto <= MESES_POR_ANIO) return _plural(absoluto, "mes", "meses");

  const anios = Math.floor(absoluto / MESES_POR_ANIO);
  const resto = absoluto % MESES_POR_ANIO;
  const partes = [_plural(anios, "año", "años")];
  if (resto > 0) partes.push(_plural(resto, "mes", "meses"));
  return _enumerar(partes);
}
