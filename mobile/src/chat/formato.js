import { aHora, claveDeDia, diaMesAnio, diasAtras, haceCuanto } from "../utils/fechas";

export { claveDeDia };

/**
 * Textos y formatos del chat (US-011, 12/11/2026), con el vocabulario de la
 * web (`Panel.jsx`, `Conversacion.jsx`, `Presencia.jsx` y `MiEstado.jsx`).
 */

/** El ícono de cada tipo de conversación (Material Community Icons). */
export const ICONO_DE_TIPO = {
  general: "bullhorn-outline",
  directa: "account-outline",
  grupo: "account-group-outline",
  area: "sitemap-outline",
};

export const NOMBRE_DE_TIPO = {
  general: "Canal general",
  directa: "Mensaje directo",
  grupo: "Grupo",
  area: "Grupo del área",
};

export function esGrupal(conversacion) {
  return conversacion?.tipo !== "directa";
}

/** «1 mensaje sin leer», «3 mensajes sin leer» (lo que oye el lector en
 * lugar del número de la insignia, como la web). */
export function textoSinLeer(cantidad) {
  return `${cantidad} ${cantidad === 1 ? "mensaje" : "mensajes"} sin leer`;
}

/** La línea del último mensaje en la lista, como la web. */
export function textoUltimo(conversacion) {
  const ultimo = conversacion?.ultimo;
  if (ultimo) return `${ultimo.propio ? "Usted" : ultimo.autor}: ${ultimo.texto}`;
  return conversacion?.tipo === "general" ? "Toda la empresa" : "Sin mensajes";
}

function mismoDia(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** La hora de la lista: «09:05» si es de hoy y «12/11/2026» si no. Sin
 * `toLocaleString`: Hermes en Android no siempre trae los datos de idioma. */
export function horaDeLista(valor, ahora = new Date()) {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) return "";
  if (mismoDia(fecha, ahora)) return aHora(fecha);
  return diaMesAnio(fecha);
}

/** La hora de un mensaje: «09:05» si es de hoy y «12/11/2026, 09:05» si no
 * (la web siempre pone la fecha). */
export function horaDeMensaje(valor, ahora = new Date()) {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) return "";
  const hora = aHora(fecha);
  if (mismoDia(fecha, ahora)) return hora;
  return `${diaMesAnio(fecha)}, ${hora}`;
}

/** Las iniciales de una persona para su avatar: «Carla Ruiz» → «CR». Lo
 * usan la lista de chats y «Nuevo mensaje». */
export function iniciales(nombre) {
  const partes = String(nombre ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length === 0) return "?";
  const letras = partes.length === 1 ? partes[0].slice(0, 2) : `${partes[0][0]}${partes[1][0]}`;
  return letras.toUpperCase();
}

/** El separador de un día: «Hoy», «Ayer» o «12/11/2026». */
export function etiquetaDeDia(valor, ahora = new Date()) {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) return "";
  const atras = diasAtras(fecha, ahora);
  if (atras <= 0) return "Hoy";
  if (atras === 1) return "Ayer";
  return diaMesAnio(fecha);
}

// --- Presencia y estados (`presencia.py` y `estados.py`) -------------------

/** Un solo texto para el reemplazo, como la web (`EtiquetaAusencia.jsx`). */
export const textoDeReemplazo = (nombre) => `Aprueba en su lugar: ${nombre}`;

/** El estado elegido que cuenta para la presencia: las vacaciones próximas
 * no (se dicen aparte). */
function elegidoVigente(presencia) {
  const elegido = presencia?.estado;
  return elegido && elegido.clave !== "vacaciones_proximas" ? elegido : null;
}

/** «En almuerzo hasta las 13:30», «En línea», «Última conexión: hace 5 min»
 * o «Sin conexiones». Lo que la persona eligió va primero (`textoPresencia`
 * de la web). */
export function textoPresencia(presencia, ahora = new Date()) {
  if (!presencia) return "";
  const elegido = elegidoVigente(presencia);
  if (elegido) return elegido.detalle;
  if (presencia.en_linea) return "En línea";
  if (!presencia.ultima_conexion) return "Sin conexiones";
  return `Última conexión: ${haceCuanto(presencia.ultima_conexion, ahora)}`;
}

/** Lo que se añade al texto: las próximas vacaciones, su mensaje y quién
 * aprueba por la persona. */
export function extrasDePresencia(presencia) {
  const elegido = presencia?.estado;
  const vigente = elegidoVigente(presencia);
  return [
    elegido?.clave === "vacaciones_proximas" ? elegido.detalle : null,
    elegido?.mensaje ? `«${elegido.mensaje}»` : null,
    vigente && elegido?.reemplazo?.nombre ? textoDeReemplazo(elegido.reemplazo.nombre) : null,
  ].filter(Boolean);
}

/**
 * El ícono de la presencia: el del estado elegido o, si no eligió, un círculo
 * lleno (en línea) o vacío (sin conexión). Siempre va con su texto: el estado
 * nunca se dice solo con el color (CA-8).
 */
export const ICONO_DE_ESTADO = {
  disponible: "check-circle-outline",
  almuerzo: "coffee-outline",
  reunion: "account-group-outline",
  no_disponible: "minus-circle-outline",
  vacaciones: "airplane",
  fuera_oficina: "exit-run",
};

export function iconoDePresencia(presencia) {
  const elegido = elegidoVigente(presencia);
  if (elegido && ICONO_DE_ESTADO[elegido.clave]) return ICONO_DE_ESTADO[elegido.clave];
  return presencia?.en_linea ? "circle" : "circle-outline";
}

/** El aviso de la conversación cuando la otra persona (o alguien del grupo,
 * al enviar) está ausente: el `AvisoDeEstado` de la web. */
export function textoAvisoDeEstado(nombre, estado) {
  if (!estado?.detalle) return "";
  const proximas = estado.clave === "vacaciones_proximas";
  const detalle = estado.detalle.charAt(0).toLowerCase() + estado.detalle.slice(1);
  let texto = proximas ? `${nombre} ${detalle}.` : `${nombre} está ${detalle}: verá su mensaje al volver.`;
  if (estado.mensaje) texto += ` «${estado.mensaje}»`;
  if (estado.reemplazo?.nombre) texto += ` ${textoDeReemplazo(estado.reemplazo.nombre)}.`;
  return texto;
}

// --- Lecturas (`EstadoLectura` de la web) -----------------------------------

/**
 * La confirmación de lectura de un mensaje propio: `{texto, leido, todos,
 * leyeron, pendientes}`. En un directo, «Enviado» o «Leído»; en un grupo,
 * «Leído por 2 de 5» o «Leído por todos». `null` si no hay a quién mirar.
 */
export function estadoDeLectura(mensaje, lecturas, grupal) {
  const lista = Array.isArray(lecturas) ? lecturas : [];
  if (lista.length === 0 || !mensaje?.id) return null;
  const leyeron = lista.filter((l) => Number(l.ultimo_leido) >= Number(mensaje.id));
  const pendientes = lista.filter((l) => Number(l.ultimo_leido) < Number(mensaje.id));
  const todos = leyeron.length === lista.length;
  let texto;
  if (!grupal) texto = leyeron.length ? "Leído" : "Enviado";
  else if (todos) texto = "Leído por todos";
  else texto = leyeron.length ? `Leído por ${leyeron.length} de ${lista.length}` : "Enviado";
  return { texto, leido: leyeron.length > 0, todos, leyeron, pendientes };
}

/** «Lo leyó a las 10:32» o «Lo leyó el 11/11/2026, 10:32». El `leido_en` es
 * cuándo leyó hasta donde está ahora, que puede ser después de este mensaje. */
export function textoLeidoEn(leidoEn, ahora = new Date()) {
  if (!leidoEn) return "Lo leyó";
  const fecha = new Date(leidoEn);
  if (Number.isNaN(fecha.getTime())) return "Lo leyó";
  return mismoDia(fecha, ahora) ? `Lo leyó a las ${aHora(fecha)}` : `Lo leyó el ${horaDeMensaje(leidoEn, ahora)}`;
}
