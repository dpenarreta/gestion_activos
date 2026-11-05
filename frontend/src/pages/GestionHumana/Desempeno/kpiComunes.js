/*
 * Etiquetas, semáforos y textos de presentación del motor de KPI (portados
 * de Nexo: `lib/analyticsExplain.ts` y las constantes de `components/kpis/*`
 * e `inteligencia-preventiva/*`). Nunca recalculan un indicador: solo
 * traducen a texto lo que ya calculó el servidor. Todo color va siempre con
 * su texto («Óptimo», «Sobrecarga»…), nunca solo.
 */
import { duracion, horas } from "../Tareas/tareasComunes";

export { horas };

/** Minutos → «2 h 30 min». */
export const duracionDeMinutos = duracion;

// --- Números -------------------------------------------------------------------

/** Número con formato de Ecuador («1.234,5»). */
export function numero(valor, decimales = 1) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-EC", { maximumFractionDigits: decimales });
}

/** «45 %». */
export function porcentaje(valor, decimales = 0) {
  if (valor === null || valor === undefined) return "—";
  return `${numero(valor, decimales)} %`;
}

/** «+3», «−2», «0» (con signo). */
export function conSigno(valor, decimales = 1) {
  const n = Number(valor) || 0;
  if (n > 0) return `+${numero(n, decimales)}`;
  if (n < 0) return `−${numero(Math.abs(n), decimales)}`;
  return "0";
}

/** Horas con signo («−2 h 30 min»). */
export function horasConSigno(valor) {
  const n = Number(valor) || 0;
  return n < 0 ? `−${horas(Math.abs(n))}` : horas(n);
}

// --- Meses ---------------------------------------------------------------------

export function mesActual() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`;
}

export function sumarMeses(mes, n) {
  let [y, m] = mes.split("-").map(Number);
  m += n;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** «2026-11» → «nov. 2026». */
export function etiquetaDeMes(mes) {
  const [y, m] = String(mes).split("-").map(Number);
  if (!y || !m) return mes;
  const corto = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-EC", {
    month: "short",
    timeZone: "UTC",
  });
  return `${corto.replace(/\.$/, "")}. ${y}`;
}

/** «2026-11» → «Noviembre de 2026». */
export function nombreDelMes(mes) {
  if (!mes) return "—";
  const [y, m] = mes.split("-").map(Number);
  const texto = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-EC", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// --- Semáforos -----------------------------------------------------------------

/** Tono de la identidad por color del motor. */
export const TONO = {
  green: "ok",
  blue: "info",
  yellow: "warn",
  orange: "warn",
  red: "bad",
  gray: "neutral",
};

export const tonoDe = (color) => TONO[color] ?? "neutral";

/** Semáforo de cumplimiento (umbral 80/60 de Nexo, `cumplimientoColor`). */
export const CUMPLIMIENTO_TEXTO = {
  green: "En meta (80 % o más)",
  yellow: "Aceptable (60 a 79 %)",
  red: "Bajo (menos de 60 %)",
};

export const CUMPLIMIENTO_CORTO = {
  green: "En meta",
  yellow: "Aceptable",
  red: "Bajo",
};

/** Lo mismo, a partir del porcentaje (`resultBarClass`). */
export function colorDeResultado(pct) {
  if (pct >= 80) return "green";
  if (pct >= 60) return "yellow";
  return "red";
}

/**
 * Los tramos del Puntaje de desempeño (Performance Score): los mismos
 * umbrales con los que el servidor lo clasifica
 * (`classify_performance_score`: Excelente ≥ 90, Bueno ≥ 75, Riesgo ≥ 60,
 * Crítico < 60). No son configurables en el servidor.
 */
export const TRAMOS_DESEMPENO = [
  { desde: 0, hasta: 60, color: "red", texto: "Crítico" },
  { desde: 60, hasta: 75, color: "yellow", texto: "Riesgo" },
  { desde: 75, hasta: 90, color: "green2", texto: "Bueno" },
  { desde: 90, hasta: 100, color: "green", texto: "Excelente" },
];

/** Los tramos del Equilibrio Operativo, a partir de la escala que envía el
 * servidor (`escala: [{ min, estado, color }]`). */
export function tramosDeEscala(escala = []) {
  const orden = [...escala].sort((a, b) => a.min - b.min);
  return orden.map((t, i) => ({
    desde: t.min,
    hasta: orden[i + 1]?.min ?? 100,
    color: t.color,
    texto: t.estado,
  }));
}

/** El Puntaje de desempeño siempre con el mismo redondeo (entero). */
export const puntos = (valor) => numero(Math.round(Number(valor) || 0), 0);

/** Nombre único del Performance Score en toda la interfaz. */
export const NOMBRE_DESEMPENO = "Puntaje de desempeño (Performance Score)";

/** Clasificación de un puntaje (Performance Score y Equilibrio). */
export const TONO_CLASIFICACION = {
  Excelente: "ok",
  Bueno: "ok",
  Riesgo: "warn",
  Crítico: "bad",
};

/** Clasificación del Índice de Riesgo Operativo. */
export const TONO_RIESGO = {
  Bajo: "ok",
  Medio: "warn",
  Alto: "warn",
  Crítico: "bad",
};

/** Severidad de una alerta automática del motor. */
export const SEVERIDAD_ALERTA = {
  red: { texto: "Acción inmediata", tono: "bad" },
  orange: { texto: "Revisar esta semana", tono: "warn" },
  yellow: { texto: "Monitorear", tono: "warn" },
  green: { texto: "Informativo", tono: "ok" },
};

/** Severidad de una alerta preventiva. */
export const SEVERIDAD_PREVENTIVA = {
  roja: { texto: "Acción inmediata", tono: "bad" },
  naranja: { texto: "Atención", tono: "warn" },
  amarilla: { texto: "Seguimiento", tono: "warn" },
  verde: { texto: "Sin riesgo", tono: "ok" },
};

/** Nivel de una predicción (sobrecarga, retraso, subutilización). */
export const TONO_NIVEL = { Alto: "bad", Medio: "warn", Bajo: "ok" };

/** Dirección de una tendencia del Trend Engine. */
export const DIRECCION = {
  positiva: { texto: "Positiva", tono: "ok", icono: "arrow-up" },
  negativa: { texto: "Negativa", tono: "bad", icono: "arrow-down" },
  estable: { texto: "Estable", tono: "neutral", icono: "arrow-right" },
  variable: { texto: "Variable", tono: "warn", icono: "shuffle" },
  cambio_brusco: { texto: "Cambio brusco", tono: "warn", icono: "lightning" },
};

/** Dirección de una tendencia del motor de KPI («mejora» / «empeoro»). */
export const TENDENCIA = {
  mejora: { texto: "Mejora", tono: "ok", verbo: "mejoró", flecha: "▲" },
  empeoro: { texto: "Empeora", tono: "bad", verbo: "disminuyó", flecha: "▼" },
  estable: {
    texto: "Estable",
    tono: "neutral",
    verbo: "se mantuvo estable",
    flecha: "=",
  },
};

export const ESTABILIDAD_TONO = {
  "Muy Alta": "ok",
  Alta: "ok",
  Media: "warn",
  Baja: "warn",
  "Muy Baja": "bad",
};

export const CONSISTENCIA_TONO = {
  "muy-consistente": "ok",
  consistente: "ok",
  variable: "warn",
  "muy-variable": "bad",
};

export const CONFIABILIDAD = { alta: "Alta", media: "Media", baja: "Baja" };

/** Estado de la capacidad proyectada. */
export const CAPACIDAD_TONO = {
  green: "ok",
  yellow: "warn",
  red: "bad",
  gray: "neutral",
};

/** Puntos sobre peso → valor normalizado (`derivedNormalizedValue`). */
export function valorNormalizado(puntos, peso) {
  return peso > 0 ? Math.round((puntos / peso) * 100 * 10) / 10 : 0;
}

/** Estrellas de madurez del dato según la cantidad de registros. */
export function madurezPorCantidad(n, umbrales = [1, 3, 6, 10]) {
  const [t1, t2, t3, t4] = umbrales;
  if (n >= t4) return 5;
  if (n >= t3) return 4;
  if (n >= t2) return 3;
  if (n >= t1) return 2;
  return 1;
}

export function madurezPorSemanas(semanas) {
  if (semanas >= 6) return 5;
  if (semanas >= 4) return 4;
  if (semanas >= 2) return 3;
  if (semanas >= 1) return 2;
  return 1;
}

const CONFIABILIDAD_POR_ESTRELLAS = { 2: 55, 3: 72, 4: 86, 5: 96 };
export function confiabilidadPorEstrellas(estrellas) {
  return CONFIABILIDAD_POR_ESTRELLAS[estrellas] ?? 50;
}

// --- Etiquetas -----------------------------------------------------------------

export const ESTADO_TAREA = {
  PENDIENTE: "Pendiente",
  EN_PROGRESO: "En progreso",
  COMPLETADA: "Completada",
  CANCELADA: "Cancelada",
};

export const TIPO_TAREA = {
  FIJA: "Fija",
  SEGUIMIENTO: "Seguimiento",
  ADMINISTRATIVO: "Administrativo",
  OPERATIVO: "Operativo",
  PROYECTO: "Proyecto",
  REUNION: "Reunión",
  CAPACITACION: "Capacitación",
};

export const PRIORIDAD_CUMPLIMIENTO = {
  ALTA: "Urgentes o alta",
  MEDIA: "Media",
  BAJA: "Baja",
};

/** Motivos de las consultas de seguimiento (los de Nexo). */
export const MOTIVO = {
  NOVEDADES_PAGO: "Novedades de pago",
  RETENCION_PAGO: "Retención de pago",
  FACTURAS: "Facturas",
  CONSULTA_OPERACIONES: "Consulta de operaciones",
  SOLICITUD_VACACIONES: "Solicitud de vacaciones",
  SOLICITUD_PERMISO: "Solicitud de permiso",
  VISITA_DOMICILIARIA: "Visita domiciliaria",
  SEGUIMIENTO_AUSENTISMOS: "Seguimiento de ausentismos",
  RECLUTAMIENTO_SELECCION: "Reclutamiento y selección",
  SEGUIMIENTO_DOCUMENTACION: "Seguimiento de documentación",
  SOLICITUDES_INTERNAS: "Solicitudes internas",
};

export const motivoLegible = (clave) =>
  MOTIVO[clave] ??
  String(clave ?? "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

/** Roles de dirección: sus indicadores individuales de ejecución no son
 * representativos (`isLeadershipRole` de Nexo: nivel 4 o más). */
export const ROLES_DE_DIRECCION = [
  "Administrador de Gestión Humana",
  "JEFE_NACIONAL",
];

export const esDeDireccion = (rol) => ROLES_DE_DIRECCION.includes(rol);

export const ESTADO_ESPECIAL = {
  MATERNIDAD: "Maternidad",
  LACTANCIA: "Lactancia",
};

export const DIA_HISTORIAL = {
  normal: null,
  empty: "Sin registro",
  holiday: "Feriado",
  "leave-medico": "Permiso médico",
  "leave-personal": "Permiso personal",
  "leave-vacaciones": "Vacaciones",
  "leave-generic": "Ausencia justificada",
  "weekend-extra": "Extra (fin de semana)",
};

// --- Textos de ayuda (`INDICATOR_HELP`) ------------------------------------------

export const AYUDA = {
  puntajeAnterior: {
    titulo: "Puntaje del mes (método anterior)",
    significa:
      "Un puntaje sencillo del mes, heredado del primer motor: sirve para comparar con meses antiguos. No es el Puntaje de desempeño.",
    calcula:
      "Suma el cumplimiento de las tareas del mes, la relación entre las horas reales y el tiempo objetivo de esas tareas, el avance de las tareas en progreso y los comentarios registrados.",
    importa:
      "A diferencia del Puntaje de desempeño (Performance Score), este sí pondera las horas frente al tiempo objetivo y no usa consistencia ni trazabilidad. Para decidir, use el Puntaje de desempeño.",
    practicas: [
      "Cerrar las tareas del mes dentro del plazo.",
      "Registrar las horas reales de cada tarea.",
      "Dejar comentarios del avance.",
    ],
  },
  performanceScore: {
    titulo: "Puntaje de desempeño (Performance Score)",
    significa:
      "Qué tan bien se está ejecutando el trabajo este mes: combina cumplimiento, tareas vencidas, consistencia y evidencia documentada.",
    calcula:
      "Cada uno de esos 4 factores se convierte en un puntaje de 0 a 100 y se pondera según su peso configurado; la suma de los 4 aportes es el Performance Score.",
    importa:
      "Es el indicador principal de ejecución individual. A diferencia del Riesgo Operativo y del Puntaje del mes (método anterior), nunca incluye carga de trabajo, horas ni capacidad futura.",
    practicas: [
      "Cerrar las tareas dentro del plazo comprometido.",
      "Evitar acumular tareas vencidas, sobre todo de prioridad Alta.",
      "Mantener un ritmo de trabajo parejo semana a semana.",
      "Documentar el avance con comentarios y actividades a diario.",
    ],
  },
  riesgoOperativo: {
    titulo: "Índice de Riesgo Operativo",
    significa:
      "Qué tan riesgoso es seguir asignando trabajo nuevo a esta persona en este momento.",
    calcula:
      "Combina 8 señales independientes (sobrecarga proyectada, tareas críticas vencidas, tendencia de cumplimiento, horas extra, capacidad futura, variabilidad, concentración de actividades y falta de planificación), cada una ponderada.",
    importa:
      "Cuando sube a Alto o Crítico se avisa automáticamente a su jefe inmediato: ayuda a decidir si conviene redistribuir trabajo antes de que se convierta en un problema.",
    practicas: [
      "Evitar acumular tareas de prioridad Alta vencidas.",
      "Definir el Tiempo Objetivo de las tareas antes de iniciarlas.",
      "Evitar horas extra sostenidas en fines de semana.",
      "Mantener un ritmo de trabajo estable.",
    ],
  },
  equilibrioOperativo: {
    titulo: "Equilibrio Operativo",
    significa:
      "El equilibrio entre cumplimiento, carga laboral, gestión de tiempos, consistencia operativa y capacidad futura, en un solo número. No representa variables médicas, psicológicas ni psicosociales: es un indicador puramente operativo.",
    calcula:
      "5 dimensiones, cada una convertida a un puntaje de 0 a 100 y ponderada. A diferencia del Performance Score, sí incluye carga laboral y capacidad futura.",
    importa:
      "Es el indicador más completo del motor: combina ejecución, carga y capacidad para dar una lectura integral de la operación.",
    practicas: [
      "Mantener la carga laboral dentro del rango óptimo.",
      "Cerrar tareas dentro del plazo.",
      "Conservar margen de capacidad para asumir trabajo nuevo.",
    ],
  },
  cargaLaboral: {
    titulo: "Carga laboral",
    significa:
      "Cuánto se está trabajando realmente (horas registradas) frente a la base laboral esperada del período.",
    calcula:
      "Se ubica en una de 5 zonas (Subutilización, Moderado, Óptimo, Carga elevada o Sobrecarga) según cómo se compara con los límites configurados.",
    importa:
      "Tanto muy por debajo como muy por encima del rango óptimo son señales de atención: la subutilización y la sobrecarga comparten color, así que hay que leer la etiqueta.",
    practicas: [
      "Registrar las horas trabajadas de forma constante.",
      "Avisar si la carga se siente sostenidamente alta o baja.",
      "Evitar que el trabajo se concentre en fines de semana.",
    ],
  },
  consistencia: {
    titulo: "Consistencia",
    significa:
      "Qué tan estable es el ritmo de trabajo semana a semana (horas, tareas completadas, cumplimiento).",
    calcula:
      "Se mide la variabilidad (coeficiente de variación) de esas 3 señales en las últimas semanas con datos válidos y se convierte en un puntaje de 0 a 100.",
    importa:
      "Un promedio bueno puede esconder semanas muy irregulares: este indicador lo detecta.",
    practicas: [
      "Evitar concentrar todo el trabajo en pocos días.",
      "Mantener un ritmo de registro diario.",
      "Planificar la semana para evitar picos y caídas fuertes.",
    ],
  },
  trazabilidad: {
    titulo: "Índice de Trazabilidad",
    significa:
      "Qué tan bien queda documentado el trabajo realizado. No mide la calidad del trabajo, solo su evidencia.",
    calcula:
      "Combina el porcentaje de días con registro (la mitad del puntaje), los comentarios del período y las actividades documentadas (un cuarto cada uno).",
    importa:
      "Un buen trabajo sin evidencia registrada es difícil de auditar o de usar como referencia.",
    practicas: [
      "Registrar avance todos los días hábiles.",
      "Dejar comentarios en las tareas relevantes.",
      "Documentar actividades de seguimiento, no solo tareas.",
    ],
  },
  tiempoObjetivo: {
    titulo: "Precisión del Tiempo Objetivo",
    significa:
      "Qué tan cerca estuvo la ejecución real del estándar operativo esperado (Tiempo Objetivo), no de una estimación propia.",
    calcula:
      "Compara las horas reales con el Tiempo Objetivo validado (o el inicial, si no se validó) y expresa el resultado como porcentaje de precisión.",
    importa:
      "Es un indicador adicional: no reemplaza al Performance Score ni al Riesgo Operativo. Ayuda a calibrar qué tan realistas son los tiempos objetivo.",
    practicas: [
      "Pedir la validación del Tiempo Objetivo antes de iniciar una tarea grande.",
      "Registrar las horas reales con precisión.",
      "Avisar si un Tiempo Objetivo resulta siempre muy corto o muy largo.",
    ],
  },
};

export const NOTA_CONSISTENCIA_NEUTRA =
  "Todavía no hay suficientes semanas con datos válidos para calcular la Consistencia real. Se usa temporalmente un puntaje neutro de 70/100 mientras se acumula historial; se reemplaza solo cuando lo haya.";

export const REFERENCIA_CLASIFICACION =
  "Clasificación por umbrales configurados: Excelente ≥ 90 · Bueno ≥ 75 · Riesgo ≥ 60 · Crítico < 60";

export const AYUDA_CALIDAD_DATO =
  "Qué tan completos y consistentes están los datos usados en este cálculo (registros, fechas, horas configuradas).";

export const AYUDA_CONFIABILIDAD =
  "Qué tan sólido es el resultado desde el punto de vista estadístico (tamaño de la muestra o del historial usado).";

/**
 * En la vista propia los textos van de «usted». Los que redacta el servidor
 * están en tercera persona («El colaborador presenta…»): aquí se adapta el
 * sujeto (pendiente de backend: que los envíe ya en segunda persona).
 */
export function segunVista(texto, propia) {
  if (!propia || typeof texto !== "string") return texto;
  return texto
    .replace(/\bEl colaborador\b/g, "Usted")
    .replace(/\bel colaborador\b/g, "usted");
}

/** Los nombres y la unidad de cada indicador del Trend Engine (el servidor
 * llama «Productividad» al Performance Score: aquí, un solo nombre). */
export const INDICADOR_TENDENCIA = {
  cumplimiento: { nombre: "Cumplimiento", unidad: " %" },
  productividad: { nombre: "Puntaje de desempeño", unidad: " pts" },
  equilibrio_operativo: { nombre: "Equilibrio Operativo", unidad: " pts" },
  capacidad_disponible: { nombre: "Capacidad disponible", unidad: " %" },
  horas_registradas: { nombre: "Horas registradas", unidad: " h" },
  consistencia_operativa: { nombre: "Consistencia operativa", unidad: " %" },
  proyectos: { nombre: "Horas en proyectos", unidad: " h" },
  actividades: { nombre: "Actividades registradas", unidad: "" },
};

/** Mensaje según el cumplimiento del período (`motivationalMessage`). */
export function mensajeDelPeriodo(pct, tareas) {
  if (!tareas) {
    return {
      tono: "info",
      texto:
        "No hay tareas registradas en este período. Consulte con su coordinador si hay actividades pendientes de asignar.",
    };
  }
  if (pct >= 90)
    return {
      tono: "ok",
      texto: "Desempeño sobresaliente en el período analizado.",
    };
  if (pct >= 80)
    return {
      tono: "ok",
      texto: "Buen desempeño: está cumpliendo con el objetivo en este período.",
    };
  if (pct >= 60)
    return {
      tono: "warn",
      texto:
        "Cumplimiento dentro del rango aceptable, con margen para mejorar.",
    };
  return {
    tono: "bad",
    texto:
      "El cumplimiento del período está por debajo del mínimo esperado (60 %). Revise las tareas vencidas y coordine con su supervisor si necesita apoyo.",
  };
}
