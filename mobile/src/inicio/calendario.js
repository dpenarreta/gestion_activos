import { colores } from "../tema/colores";

/**
 * El calendario de Inicio en la app (16/11/2026, a pedido del usuario): el
 * mismo de la web (`CalendarioInicio.jsx`), con los feriados, los eventos
 * importantes y las celebraciones que publica la empresa. Lee
 * `GET /organizacion/calendario/?desde&hasta`, que ya da cada aparición del
 * rango (las de varios días con su fin y las anuales en cada año).
 */

/** Cada tipo con su nombre, ícono y color. El tipo nunca va solo en el
 * color: la cuadrícula lleva el ícono y la lista lo dice en texto. */
export const TIPOS_EN_CALENDARIO = {
  feriado: { nombre: "Feriado", icono: "flag", color: colores.malTexto },
  evento: { nombre: "Evento", icono: "star", color: colores.infoTexto },
  cumpleanos: {
    nombre: "Cumpleaños",
    icono: "gift",
    color: colores.avisoTexto,
  },
  aniversario: {
    nombre: "Aniversario",
    icono: "medal",
    color: colores.bienTexto,
  },
};

export function tipoDe(evento) {
  return TIPOS_EN_CALENDARIO[evento?.tipo] ?? TIPOS_EN_CALENDARIO.evento;
}

/** Las pestañas de la web: lo importante por un lado y las celebraciones de
 * las personas por otro, para que los cumpleaños no tapen los feriados. */
export const GRUPOS_DE_EVENTO = [
  {
    id: "importantes",
    nombre: "Eventos y feriados",
    tipos: ["evento", "feriado"],
  },
  {
    id: "celebraciones",
    nombre: "Celebraciones",
    tipos: ["cumpleanos", "aniversario"],
  },
];

export function enGrupo(evento, grupo) {
  const tipos = GRUPOS_DE_EVENTO.find((g) => g.id === grupo)?.tipos;
  return !tipos || tipos.includes(evento?.tipo);
}

const MESES = [
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

function aIso(fecha) {
  return `${fecha.getUTCFullYear()}-${dos(fecha.getUTCMonth() + 1)}-${dos(fecha.getUTCDate())}`;
}

function deIso(iso) {
  const [a, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

/** «AAAA-MM-DD» más (o menos) `n` días. */
export function sumarDias(iso, n) {
  const fecha = deIso(iso);
  fecha.setUTCDate(fecha.getUTCDate() + n);
  return aIso(fecha);
}

/** Los 42 días (6 semanas, desde el lunes) que se dibujan para un mes. */
export function diasDeLaCuadricula(anio, mes) {
  const primero = new Date(Date.UTC(anio, mes - 1, 1));
  const corrimiento = (primero.getUTCDay() + 6) % 7; // lunes = 0
  const inicio = aIso(new Date(Date.UTC(anio, mes - 1, 1 - corrimiento)));
  return Array.from({ length: 42 }, (_, i) => {
    const iso = sumarDias(inicio, i);
    return {
      iso,
      numero: Number(iso.slice(8)),
      delMes: Number(iso.slice(5, 7)) === mes,
    };
  });
}

/** Cada día («AAAA-MM-DD») con lo que cae en él, incluidos los días
 * intermedios de las fechas que duran varios. */
export function porDia(apariciones = []) {
  const mapa = {};
  for (const a of apariciones) {
    if (!a?.fecha) continue;
    const fin = a.fecha_fin && a.fecha_fin >= a.fecha ? a.fecha_fin : a.fecha;
    // Tope de seguridad: ningún evento ocupa más de un año.
    for (
      let d = a.fecha, n = 0;
      d <= fin && n < 400;
      d = sumarDias(d, 1), n++
    ) {
      (mapa[d] ??= []).push(a);
    }
  }
  return mapa;
}

export function tituloDelMes(anio, mes) {
  return `${MESES[mes - 1].charAt(0).toUpperCase()}${MESES[mes - 1].slice(1)} ${anio}`;
}

/** «lunes 16 de noviembre». */
export function diaConNombre(iso) {
  const fecha = deIso(iso);
  return `${DIAS_LARGOS[fecha.getUTCDay()]} ${fecha.getUTCDate()} de ${MESES[fecha.getUTCMonth()]}`;
}

function diaYMes(iso) {
  return `${Number(iso.slice(8))} de ${MESES[Number(iso.slice(5, 7)) - 1]}`;
}

/** «del 16 al 17 de febrero»; con meses distintos, cada uno con el suyo. */
export function rango(desde, hasta) {
  if (desde.slice(0, 7) === hasta.slice(0, 7))
    return `del ${Number(desde.slice(8))} al ${diaYMes(hasta)}`;
  return `del ${diaYMes(desde)} al ${diaYMes(hasta)}`;
}

/** Lo que acompaña al título: tipo, duración o día, y si se repite. */
export function datosDelEvento(evento, { conDia = false } = {}) {
  const varios = evento.fecha_fin && evento.fecha_fin !== evento.fecha;
  return [
    tipoDe(evento).nombre,
    varios
      ? rango(evento.fecha, evento.fecha_fin)
      : conDia
        ? diaConNombre(evento.fecha)
        : null,
    evento.cada_anio ? "cada año" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Cada fecha una vez, aunque ocupe varios días. */
export function unicas(lista = []) {
  return [...new Map(lista.map((e) => [`${e.id}-${e.fecha}`, e])).values()];
}

/** El nombre que lee el lector de pantalla para un día de la cuadrícula:
 * «lunes 16 de noviembre, hoy, 1 feriado». */
export function nombreDelDia(dia, eventos, { hoy, elegido } = {}) {
  const partes = [diaConNombre(dia.iso)];
  if (dia.iso === hoy) partes.push("hoy");
  if (dia.iso === elegido) partes.push("elegido");
  if (!eventos.length) partes.push("sin fechas");
  const cuantos = {};
  for (const e of eventos) cuantos[e.tipo] = (cuantos[e.tipo] ?? 0) + 1;
  for (const [tipo, n] of Object.entries(cuantos)) {
    const nombre = (
      TIPOS_EN_CALENDARIO[tipo]?.nombre ?? "Evento"
    ).toLowerCase();
    partes.push(
      n === 1
        ? `1 ${nombre}`
        : `${n} ${nombre === "cumpleaños" ? nombre : `${nombre}s`}`,
    );
  }
  return partes.join(", ");
}
