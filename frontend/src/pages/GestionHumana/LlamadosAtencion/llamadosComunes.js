/*
 * Piezas comunes de «Llamados de atención» (US-013). El contrato exacto de
 * los campos lo confirma DEV-2: aquí se leen con tolerancia (un nombre puede
 * venir como texto o como objeto `{ id, nombre }`).
 */

export const TIPOS = {
  verbal: "Verbal",
  escrito: "Escrito",
  sancion_economica: "Sanción económica",
};
export const SANCION = "sancion_economica";

/** Cada estado con su texto, su tono de la identidad y su ícono: el color
 * nunca va solo. */
export const ESTADOS = {
  solicitado: { texto: "Solicitado", tono: "warn", icono: "hourglass-split" },
  emitido: { texto: "Emitido", tono: "ok", icono: "check2-circle" },
  rechazado: { texto: "Rechazado", tono: "bad", icono: "x-circle" },
  anulado: { texto: "Anulado", tono: "neutral", icono: "slash-circle" },
};

/** Valores de ejemplo para la vista previa (la variable de `variables/` puede
 * traer el suyo en `ejemplo`). */
export const EJEMPLOS = {
  nombre: "María",
  apellidos: "Pérez Andrade",
  causa: "Incumplimiento de la firma del rol de pagos",
  nivel: "Segundo llamado (escrito)",
  fecha_hecho: "05/11/2026",
  descripcion: "No firmó el rol de pagos dentro del plazo.",
  monto: "$ 10,00",
  empresa: "LAARCOURIER",
  emitido_por: "Gestión Humana",
};

/** El nombre de algo que llega como texto o como objeto. */
export function nombreDe(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "object") {
    return valor.nombre ?? valor.full_name ?? valor.name ?? `#${valor.id}`;
  }
  return String(valor);
}

/** El id de algo que llega como número, texto u objeto. */
export function idDe(valor) {
  if (valor && typeof valor === "object") return valor.id ?? null;
  return valor ?? null;
}

export const personaDe = (l) => l.persona ?? l.persona_nombre;
export const causaDe = (l) => l.causa ?? l.causa_nombre;
export const nivelDe = (l) => l.nivel_aplicado ?? l.nivel ?? l.nivel_nombre;

/** El tipo del nivel de un llamado, si el servidor lo trae. */
export function tipoDe(llamado) {
  const nivel = nivelDe(llamado);
  return (
    (nivel && typeof nivel === "object" ? nivel.tipo : null) ??
    llamado.nivel_tipo ??
    llamado.tipo ??
    null
  );
}

/** El número de «1.234,50» o «10.5» a un texto con punto; `null` si no lo es. */
export function montoANumero(texto) {
  const limpio = String(texto ?? "")
    .trim()
    .replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  return limpio;
}

/** Quien llega de `personas/` con la forma del selector de personas. */
export function comoPersona(p) {
  return {
    id: p.id,
    full_name: p.full_name ?? p.nombre ?? p.name ?? `#${p.id}`,
    username: p.username,
    role_label: p.cargo ?? p.role_label,
    nombres: p.nombres,
    apellidos: p.apellidos,
    jefe: p.jefe,
  };
}

/** La clave de una variable (`nombre`), con o sin llaves. */
export const claveDeVariable = (v) =>
  String(typeof v === "string" ? v : (v.clave ?? v.nombre ?? ""))
    .replace(/^\{|\}$/g, "")
    .trim();

/** Reemplaza las variables de una plantilla por sus valores. Entiende
 * `{variable}` y las secciones `{{#variable}}…{{/variable}}` (solo se
 * muestran si la variable tiene valor). Devuelve **texto**: se pinta como
 * contenido de React (escapado), nunca como HTML. `desconocidas` son las
 * variables sin valor ni ejemplo, que se dejan tal cual. */
export function renderPlantilla(texto, valores) {
  const desconocidas = new Set();
  const tiene = (clave) =>
    Object.prototype.hasOwnProperty.call(valores, clave) &&
    valores[clave] !== "" &&
    valores[clave] !== null &&
    valores[clave] !== undefined;
  const sinSecciones = String(texto ?? "").replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_c, clave, dentro) => (tiene(clave) ? dentro : ""),
  );
  const resultado = sinSecciones.replace(/\{(\w+)\}/g, (completo, clave) => {
    if (tiene(clave)) return String(valores[clave]);
    desconocidas.add(clave);
    return completo;
  });
  return { texto: resultado, desconocidas: [...desconocidas] };
}

/** Lo mismo con los ejemplos (la variable de `variables/` puede traer el
 * suyo en `ejemplo`). */
export function conEjemplos(texto, variables = []) {
  const propios = Object.fromEntries(
    variables
      .filter((v) => typeof v === "object" && v.ejemplo)
      .map((v) => [claveDeVariable(v), v.ejemplo]),
  );
  return renderPlantilla(texto, { ...EJEMPLOS, ...propios }).texto;
}

/** Los niveles activos de una causa, en su orden. */
export function nivelesDe(causa) {
  return [...(causa?.niveles ?? [])]
    .filter((n) => n.activo !== false)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

/** El id del nivel que propone el servidor. */
export function nivelPropuesto(propuesta) {
  if (!propuesta) return null;
  return idDe(
    propuesta.nivel_propuesto ?? propuesta.nivel_id ?? propuesta.nivel,
  );
}

/** Nombres y apellidos de una persona para las variables de la plantilla:
 * los del servidor si vienen; si no, el nombre completo partido por la mitad. */
export function nombreYApellidos(persona) {
  if (persona?.nombres || persona?.apellidos) {
    return {
      nombre: persona.nombres ?? "",
      apellidos: persona.apellidos ?? "",
    };
  }
  const partes = String(persona?.full_name ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const mitad = Math.ceil(partes.length / 2);
  return {
    nombre: partes.slice(0, mitad).join(" "),
    apellidos: partes.slice(mitad).join(" "),
  };
}

/** El nivel propuesto de un llamado solicitado: la propuesta vigente (se
 * recalcula con los llamados de hoy: pudo cambiar desde que se pidió) y, si
 * no viene, la que tenía al solicitarse. */
export function propuestoDe(llamado) {
  const vigente = llamado?.propuesta_vigente;
  const id =
    vigente && typeof vigente === "object"
      ? nivelPropuesto(vigente)
      : (vigente ?? null);
  return id ?? idDe(llamado?.nivel_propuesto);
}

/** El jefe que sale en «con copia a»: el nombre si lo hay, `null` si la
 * persona no tiene jefe y `undefined` si no se sabe (no hay propuesta). */
export function jefeDe(propuesta) {
  if (!propuesta || typeof propuesta !== "object") return undefined;
  if (propuesta.jefe === null) return null;
  if (propuesta.jefe) return nombreDe(propuesta.jefe);
  return undefined;
}

/** Si la respuesta de emitir o confirmar dice que el correo no salió, el
 * aviso de éxito se vuelve de advertencia y lo dice. */
export function avisoDeEmision(respuesta, textoOk) {
  const estado = respuesta?.correo?.estado;
  if (estado === "fallido") {
    return {
      tono: "warn",
      texto: `${textoOk} Pero el correo no se pudo enviar: notifique a la persona por otro medio.`,
    };
  }
  if (estado === "sin_direccion") {
    return {
      tono: "warn",
      texto: `${textoOk} Pero la persona no tiene correo registrado, así que no se envió: notifíquela por otro medio.`,
    };
  }
  return { texto: textoOk };
}
