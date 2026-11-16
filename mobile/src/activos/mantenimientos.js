import { TONOS } from "../soporte/formato";
import { aIso, fechaCorta } from "../utils/fechas";
import { dinero } from "./formato";

/**
 * La bitácora de mantenimientos en la app (US-022, Tanda B, 16/11/2026): la
 * lista (CA-13), «Registrar mantenimiento» con sus repuestos (CA-14, CA-15) y
 * «Registrar salida» (CA-16), con las opciones y las reglas de
 * `backend/apps/mantenimientos/` (`models.py`, `MantenimientoWriteSerializer`
 * y `ComponenteLineaSerializer`) y los textos de `MantenimientoForm.jsx` de la
 * web. Es código puro: lo usan las pantallas y las pruebas.
 */

// --- Opciones del modelo ------------------------------------------------------------

/** `Mantenimiento.Tipo`, en el orden de la web (correctivo primero: es lo
 * más común en el sitio). */
export const TIPOS_DE_MANTENIMIENTO = [
  { valor: "correctivo", texto: "Correctivo" },
  { valor: "preventivo", texto: "Preventivo" },
];

/** `Mantenimiento.TipoResponsable`. */
export const TIPOS_DE_RESPONSABLE = [
  { valor: "tecnico_interno", texto: "Técnico interno" },
  { valor: "proveedor_externo", texto: "Proveedor externo" },
];

/** `Mantenimiento.EstadoFinal`. */
export const ESTADOS_FINALES = [
  { valor: "reparado", texto: "Reparado" },
  { valor: "pendiente", texto: "Pendiente" },
  { valor: "no_reparable", texto: "No reparable" },
  { valor: "dado_de_baja", texto: "Dado de baja" },
];

/** Los finales con los que el equipo NO vuelve a operar al cerrar
 * (`_FINALES_SIN_VUELTA` de `services.py`): se queda «En reparación» hasta
 * que alguien decida desde la ficha. */
export const FINALES_SIN_VUELTA = ["no_reparable", "dado_de_baja"];

export const TEXTO_SIN_VUELTA =
  "Con este estado final el equipo no vuelve a operar: queda «En reparación» hasta que se decida qué hacer con él desde su ficha (por ejemplo, darlo de baja).";

/** Las causas que sugiere la web, para que la misma falla no se escriba de
 * tres formas (es lo que permite ver causas recurrentes). */
export const CAUSAS_SUGERIDAS = [
  "Pantalla dañada",
  "Batería agotada",
  "Disco fallando",
  "Teclado dañado",
  "Lentitud",
  "Virus o malware",
  "Fuente de poder",
  "Sobrecalentamiento",
  "Falla de red",
  "Mantenimiento preventivo",
];

/** Los largos del modelo. */
export const LARGO_RESPONSABLE = 150;
export const LARGO_CAUSA = 150;
export const LARGO_SERIE = 120;

// --- Lista (CA-13) ------------------------------------------------------------------

/** Los chips de abiertos y cerrados, con `pendientes` de `GET
 * mantenimientos/`. Un aviso de «Reparaciones sin cerrar» abre «Abiertos». */
export const FILTROS_DE_MANTENIMIENTOS = [
  { clave: "todos", texto: "Todos", params: {} },
  { clave: "abiertos", texto: "Abiertos", params: { pendientes: "true" } },
  { clave: "cerrados", texto: "Cerrados", params: { pendientes: "false" } },
];

export function filtroDeMantenimientos(clave) {
  return FILTROS_DE_MANTENIMIENTOS.find((f) => f.clave === clave) ?? FILTROS_DE_MANTENIMIENTOS[0];
}

/** Los parámetros de una página de la bitácora. `tipo` vacío: todos. */
export function parametrosDeMantenimientos({ filtro, tipo, q, pagina = 1 }) {
  const params = { ...filtroDeMantenimientos(filtro).params, page: pagina };
  if (TIPOS_DE_MANTENIMIENTO.some((t) => t.valor === tipo)) params.tipo = tipo;
  const texto = String(q ?? "").trim();
  if (texto) params.q = texto;
  return params;
}

export function cuantosMantenimientos(n) {
  const total = Number(n) || 0;
  return `${total} ${total === 1 ? "mantenimiento" : "mantenimientos"}`;
}

/** Abierto (sin fecha de salida) o cerrado con su estado final, con texto e
 * ícono (CA-23). */
export function estadoDelMantenimiento(m) {
  if (!m?.fecha_salida) return { texto: "Abierto", abierto: true, ...TONOS.aviso, icono: "progress-wrench" };
  const sinVuelta = FINALES_SIN_VUELTA.includes(m.estado_final);
  return {
    texto: m.estado_final_display || "Cerrado",
    abierto: false,
    ...(sinVuelta ? TONOS.mal : TONOS.bien),
    icono: sinVuelta ? "close-circle-outline" : "check-circle-outline",
  };
}

/** «Desde el 10/11/2026 · sigue fuera de operación» o «01/09/2026 al
 * 02/09/2026». */
export function fechasDelMantenimiento(m) {
  if (!m?.fecha_salida) return `Desde el ${fechaCorta(m?.fecha_intervencion)} · sigue fuera de operación`;
  return `${fechaCorta(m.fecha_intervencion)} al ${fechaCorta(m.fecha_salida)}`;
}

/** «3 días fuera de operación»; `null` si sigue abierto. */
export function diasFuera(m) {
  const dias = Number(m?.dias_fuera_de_operacion);
  if (!m?.fecha_salida || !Number.isFinite(dias)) return null;
  return `${dias} ${dias === 1 ? "día" : "días"} fuera de operación`;
}

/** Lo que dice el lector de pantalla de una fila de la bitácora. */
export function nombreDeFilaMantenimiento(m) {
  const estado = estadoDelMantenimiento(m);
  return [
    [m?.activo_codigo, m?.activo_nombre].filter(Boolean).join(", "),
    m?.tipo_display || m?.tipo,
    `Estado: ${estado.texto}`,
    fechasDelMantenimiento(m),
    diasFuera(m),
    `Costo: ${dinero(m?.costo_total)}`,
  ]
    .filter(Boolean)
    .join(". ");
}

// --- Registrar (CA-14, CA-15) -------------------------------------------------------

/** «AAAA-MM-DD» de hoy en el teléfono (el servidor compara con su fecha
 * local, la de Ecuador). */
export function hoyIso(ahora = new Date()) {
  return aIso(ahora);
}

export function valoresIniciales(hoy = hoyIso()) {
  return {
    tipo: "correctivo",
    fecha_intervencion: hoy,
    fecha_salida: "",
    tipo_responsable: "tecnico_interno",
    responsable: "",
    causa: "",
    descripcion: "",
    diagnostico: "",
    solucion: "",
    estado_final: "reparado",
    garantia_usada: false,
    costo_mano_obra: "",
  };
}

/** Si el formulario tiene algo que perder (para `confirmarDescarte`). */
export function hayCambiosEnElRegistro(iniciales, valores, lineas = []) {
  if (lineas.length > 0) return true;
  return Object.keys(iniciales).some((c) => String(iniciales[c] ?? "") !== String(valores[c] ?? ""));
}

let siguienteLinea = 0;

/** Una línea de repuesto recién elegida del catálogo. `uid`: su clave
 * estable en la lista (UX H-11): quitar una no cambia la de las demás. */
export function lineaDe(componente) {
  siguienteLinea += 1;
  return {
    uid: `linea-${siguienteLinea}`,
    componente: String(componente.id),
    nombre: componente.nombre,
    codigo: componente.codigo || "",
    critico: Boolean(componente.es_critico),
    cantidad: "1",
    costo_unitario: "",
    numero_serie_nuevo: "",
    observaciones: "",
  };
}

/** Un monto como lo acepta el servidor (`DecimalField` de 2 decimales):
 * «12,5» y «12.50» valen; `null` si está vacío; `NaN` si no es un monto. */
export function montoDe(texto) {
  const limpio = String(texto ?? "")
    .trim()
    .replace(",", ".");
  if (!limpio) return null;
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(limpio)) return Number.NaN;
  return limpio;
}

export const TEXTO_MONTO_INVALIDO = "Escriba un monto, por ejemplo 25 o 25,50 (sin signos ni separadores de miles).";

function cantidadDe(texto) {
  const limpio = String(texto ?? "").trim();
  if (!/^\d{1,6}$/.test(limpio)) return Number.NaN;
  return Number(limpio);
}

/** Los errores de cada línea de repuesto, en su orden: `[{campo: texto}]`. */
export function validarLineas(lineas = []) {
  return lineas.map((l) => {
    const errores = {};
    const cantidad = cantidadDe(l.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1) errores.cantidad = "La cantidad es un número entero de al menos 1.";
    if (Number.isNaN(montoDe(l.costo_unitario))) errores.costo_unitario = TEXTO_MONTO_INVALIDO;
    return errores;
  });
}

/**
 * Lo que se revisa antes de enviar, con los mensajes del servidor cuando los
 * hay. `fechaAdquisicion`: la del activo elegido («AAAA-MM-DD»).
 */
export function validarRegistro({ activo, valores, lineas = [], hoy = hoyIso(), fechaAdquisicion, salio }) {
  const errores = {};
  if (!activo) errores.activo = "Elija el equipo al que se le hizo el mantenimiento.";
  if (!valores.fecha_intervencion) errores.fecha_intervencion = "Elija la fecha de ingreso.";
  else if (valores.fecha_intervencion > hoy) errores.fecha_intervencion = "La fecha de intervención no puede ser futura.";
  else if (fechaAdquisicion && valores.fecha_intervencion < fechaAdquisicion) {
    errores.fecha_intervencion = `La intervención es anterior a la fecha de adquisición del activo (${fechaCorta(fechaAdquisicion)}).`;
  }
  if (salio === true && !valores.fecha_salida) errores.fecha_salida = "Elija la fecha en que el equipo salió del taller.";
  if (valores.fecha_salida) {
    if (valores.fecha_salida > hoy) errores.fecha_salida = "La fecha de salida no puede ser futura.";
    else if (valores.fecha_intervencion && valores.fecha_salida < valores.fecha_intervencion) {
      errores.fecha_salida = "La salida no puede ser anterior al ingreso.";
    }
  }
  if (!String(valores.responsable ?? "").trim()) errores.responsable = "Escriba el nombre del técnico o del proveedor.";
  if (!String(valores.descripcion ?? "").trim()) errores.descripcion = "Describa el trabajo realizado.";
  if (Number.isNaN(montoDe(valores.costo_mano_obra))) errores.costo_mano_obra = TEXTO_MONTO_INVALIDO;
  if (validarLineas(lineas).some((e) => Object.keys(e).length > 0)) {
    errores.componentes = "Revise los repuestos marcados.";
  }
  return errores;
}

/** El cuerpo de `POST mantenimientos/`, como la web: vacío en la salida es
 * «sigue fuera de operación»; sin `proveedor` por línea (el servidor no lo
 * guarda: pendiente de DEV-2). Con `salio === false` (UX H-04), lo de la
 * salida que quedó oculto no se envía. */
export function cuerpoDelRegistro({ activo, valores: todos, lineas = [], salio }) {
  const valores = salio === false ? { ...todos, fecha_salida: "", solucion: "", estado_final: "reparado" } : todos;
  return {
    activo: Number(activo),
    tipo: valores.tipo,
    fecha_intervencion: valores.fecha_intervencion,
    fecha_salida: valores.fecha_salida || null,
    tipo_responsable: valores.tipo_responsable,
    responsable: String(valores.responsable ?? "").trim(),
    causa: String(valores.causa ?? "").trim(),
    descripcion: String(valores.descripcion ?? "").trim(),
    diagnostico: String(valores.diagnostico ?? "").trim(),
    solucion: String(valores.solucion ?? "").trim(),
    estado_final: valores.estado_final,
    garantia_usada: Boolean(valores.garantia_usada),
    costo_mano_obra: montoDe(valores.costo_mano_obra),
    componentes: lineas.map((l) => ({
      componente: Number(l.componente),
      cantidad: cantidadDe(l.cantidad),
      costo_unitario: montoDe(l.costo_unitario),
      numero_serie_nuevo: String(l.numero_serie_nuevo ?? "").trim(),
      observaciones: String(l.observaciones ?? "").trim(),
    })),
  };
}

/** El costo de los repuestos mientras se capturan. */
export function totalDeRepuestos(lineas = []) {
  return lineas.reduce((suma, l) => {
    const monto = Number(montoDe(l.costo_unitario));
    const cantidad = cantidadDe(l.cantidad);
    return Number.isFinite(monto) && Number.isFinite(cantidad) ? suma + monto * cantidad : suma;
  }, 0);
}

/** Cuántas piezas críticas se registran (cuentan para la renovación). */
export function piezasCriticas(lineas = []) {
  return lineas.reduce((suma, l) => (l.critico ? suma + (cantidadDe(l.cantidad) || 0) : suma), 0);
}

/** Días entre el ingreso y la salida mientras se capturan. */
export function diasEntre(desde, hasta) {
  if (!desde || !hasta) return null;
  const a = new Date(`${desde}T12:00:00`);
  const b = new Date(`${hasta}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(Math.round((b - a) / 86400000), 0);
}

/**
 * Los errores 400 de las líneas de repuestos (`componentes: [{cantidad:
 * [...]}, {}]`), en su orden: `[{campo: texto}]`. Lo que no es de una línea
 * (`componentes: ["..."]`) va en `general`.
 */
export function erroresDeLineas(error) {
  const detalles = error?.response?.data?.error?.details ?? error?.response?.data;
  const valor = detalles && typeof detalles === "object" ? detalles.componentes : undefined;
  if (!Array.isArray(valor)) return { lineas: [], general: typeof valor === "string" ? valor : null };
  if (valor.every((v) => typeof v === "string")) return { lineas: [], general: valor.join(" ") };
  const lineas = valor.map((l) => {
    const errores = {};
    if (l && typeof l === "object" && !Array.isArray(l)) {
      for (const [campo, texto] of Object.entries(l)) {
        errores[campo] = Array.isArray(texto) ? texto.filter((t) => typeof t === "string").join(" ") : String(texto);
      }
    }
    return errores;
  });
  return { lineas, general: null };
}

/** A quién avisó el servidor por correo (`aviso` de la respuesta), dicho
 * después de guardar: quien no tiene correo no se enteró. `null` si no hay
 * nada que decir. */
export function textoDelAvisoDeMantenimiento(aviso) {
  const sinCorreo = Array.isArray(aviso?.sin_correo) ? aviso.sin_correo.filter(Boolean) : [];
  if (sinCorreo.length === 0) return null;
  const nombres = sinCorreo.length === 1 ? sinCorreo[0] : `${sinCorreo.slice(0, -1).join(", ")} y ${sinCorreo.at(-1)}`;
  return `${nombres} ${sinCorreo.length === 1 ? "no tiene" : "no tienen"} correo en su ficha y no ${
    sinCorreo.length === 1 ? "recibió" : "recibieron"
  } el aviso.`;
}

/** Antes de guardar: a quién se avisará por correo (como la web,
 * `AvisoDeNotificacion`). Nunca muestra direcciones. */
export function quienRecibeElAviso(activo) {
  if (!activo) return null;
  const responsables = activo.responsables ?? [];
  if (responsables.length === 0) return "Nadie responde por este equipo, así que el aviso le llegará a usted.";
  const con = responsables.filter((p) => p.recibe_avisos !== false).map((p) => p.nombre_completo);
  const sin = responsables.filter((p) => p.recibe_avisos === false).map((p) => p.nombre_completo);
  const partes = [];
  if (con.length) partes.push(`Se avisará por correo a ${con.join(", ")}.`);
  if (sin.length) {
    partes.push(
      `${sin.join(", ")} ${sin.length === 1 ? "no tiene" : "no tienen"} correo en su ficha y no ${
        sin.length === 1 ? "recibirá" : "recibirán"
      } el aviso${con.length === 0 ? "; le llegará a usted." : "."}`,
    );
  }
  return partes.join(" ");
}

// --- Crear componente (CA-15) -------------------------------------------------------

export function validarComponenteNuevo({ nombre, codigo }) {
  const errores = {};
  if (!String(nombre ?? "").trim()) errores.nombre = "Escriba el nombre del componente.";
  if (!String(codigo ?? "").trim()) errores.codigo = "Escriba un código corto (por ejemplo, DISCO-SSD).";
  return errores;
}

/** El servidor guarda el código en mayúsculas (`validate_codigo`). */
export function cuerpoDelComponente({ nombre, codigo, descripcion, es_critico }) {
  return {
    nombre: String(nombre ?? "").trim(),
    codigo: String(codigo ?? "")
      .trim()
      .toUpperCase(),
    descripcion: String(descripcion ?? "").trim(),
    es_critico: Boolean(es_critico),
  };
}

// --- Cerrar (CA-16) -----------------------------------------------------------------

export function valoresDeCierre(m, hoy = hoyIso()) {
  return { fecha_salida: hoy, solucion: m?.solucion ?? "", estado_final: "reparado" };
}

export function validarCierre(m, valores, hoy = hoyIso()) {
  const errores = {};
  if (!valores.fecha_salida) errores.fecha_salida = "Elija la fecha en que el equipo salió del taller.";
  else if (valores.fecha_salida > hoy) errores.fecha_salida = "La fecha de salida no puede ser futura.";
  else if (m?.fecha_intervencion && valores.fecha_salida < m.fecha_intervencion) {
    errores.fecha_salida = "La salida no puede ser anterior al ingreso.";
  }
  if (!ESTADOS_FINALES.some((e) => e.valor === valores.estado_final)) errores.estado_final = "Elija el estado final.";
  return errores;
}

/** El cuerpo del `PATCH mantenimientos/{id}/`: solo lo de la salida. */
export function cuerpoDelCierre(valores) {
  return {
    fecha_salida: valores.fecha_salida,
    solucion: String(valores.solucion ?? "").trim(),
    estado_final: valores.estado_final,
  };
}

/** Lo que se anuncia al cerrar. */
export function resultadoDelCierre(valores) {
  return FINALES_SIN_VUELTA.includes(valores.estado_final)
    ? "Salida registrada. El equipo sigue «En reparación» hasta que se decida desde su ficha."
    : "Salida registrada. El equipo vuelve al estado que tenía antes de la reparación.";
}

// --- Adjuntos (CA-17) ---------------------------------------------------------------

/** `Adjunto.Tipo`, con los de un mantenimiento primero. */
export const TIPOS_DE_ADJUNTO = [
  { valor: "foto", texto: "Foto del equipo" },
  { valor: "informe_tecnico", texto: "Informe técnico" },
  { valor: "evidencia_dano", texto: "Evidencia de daño" },
  { valor: "cotizacion", texto: "Cotización de reparación" },
  { valor: "factura", texto: "Factura de compra" },
  { valor: "garantia", texto: "Garantía" },
  { valor: "acta_entrega", texto: "Acta de entrega" },
  { valor: "acta_devolucion", texto: "Acta de devolución" },
  { valor: "documento_baja", texto: "Documento de baja" },
];

export const LARGO_DESCRIPCION_ADJUNTO = 255;
