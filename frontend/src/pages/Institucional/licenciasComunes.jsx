/*
 * Lo que comparten la Solicitud de permisos y la configuración de sus flujos:
 * los estados, los destinos (a quién apunta un aprobador o un aviso) y el
 * selector para elegir uno.
 */

export const ESTADOS = {
  pendiente: ["Pendiente", "mz-pill--warn"],
  aprobada: ["Aprobada", "mz-pill--ok"],
  rechazada: ["Rechazada", "mz-pill--bad"],
  cancelada: ["Cancelada", "mz-pill--neutral"],
};

export const DESTINOS = {
  solicitante: "Quien solicita",
  aprobadores: "Quienes aprobaron",
  jefe_inmediato: "Su jefe inmediato (organigrama)",
  persona: "Una persona",
  rol: "Las personas de un rol",
  cargo: "Quien ocupe un cargo",
};

/** Los que sirven para aprobar o escalar (no quien solicita). */
export const DESTINOS_APROBADOR = ["jefe_inmediato", "persona", "rol", "cargo"];
export const DESTINOS_ESCALAR = ["persona", "rol", "cargo"];
export const DESTINOS_AVISO = Object.keys(DESTINOS);

const CAMPO = { persona: "usuario", rol: "rol", cargo: "cargo" };
const LISTA = { persona: "personas", rol: "roles", cargo: "cargos" };

/**
 * Elegir un destino: su tipo y, si es una persona, un rol o un cargo, cuál.
 * `valor` es { tipo, usuario, rol, cargo }.
 */
export function SelectorDestino({
  id,
  valor,
  onCambio,
  opciones,
  tipos,
  etiqueta = "A quién",
  // Si falta elegir a quién: se marca el selector que hay que completar
  // (auditoría UX/UI de los tipos de permiso, 29/10/2026).
  invalido = false,
  describedBy,
}) {
  const campo = CAMPO[valor.tipo];
  const lista = opciones?.[LISTA[valor.tipo]] ?? [];
  const marca = (propio) =>
    invalido && propio
      ? { "aria-invalid": true, "aria-describedby": describedBy }
      : {};
  const clase = (propio) =>
    `form-select form-select-sm${invalido && propio ? " is-invalid" : ""}`;
  return (
    <div
      className={`selector-destino${campo ? "" : " selector-destino--solo"}`}
    >
      <select
        id={id}
        aria-label={etiqueta}
        className={clase(!campo)}
        {...marca(!campo)}
        value={valor.tipo}
        onChange={(e) =>
          onCambio({
            tipo: e.target.value,
            usuario: null,
            rol: null,
            cargo: null,
          })
        }
      >
        {tipos.map((t) => (
          <option key={t} value={t}>
            {DESTINOS[t]}
          </option>
        ))}
      </select>
      {campo && (
        <select
          aria-label={`${etiqueta}: ${DESTINOS[valor.tipo].toLowerCase()}`}
          className={clase(true)}
          {...marca(true)}
          value={valor[campo] ?? ""}
          onChange={(e) =>
            onCambio({
              ...valor,
              [campo]: e.target.value ? Number(e.target.value) : null,
            })
          }
        >
          <option value="">Elija…</option>
          {lista.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nombre}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function fechas(desde, hasta, formatear) {
  return desde === hasta
    ? formatear(desde)
    : `${formatear(desde)} al ${formatear(hasta)}`;
}

/** Qué descuenta un tipo de permiso (`FlujoPermiso.descuento`), en palabras
 * de quien lo pide (05/11/2026). */
export const DESCUENTOS = {
  sueldo: "Se descuenta del sueldo",
  vacaciones: "Se descuenta de las vacaciones pendientes",
  ninguno: "Permiso con sueldo (no se descuenta)",
};

/** Los minutos entre dos horas «HH:MM», o `null` si falta alguna. */
export function minutosEntre(inicio, fin) {
  const leer = (texto) => {
    const partes = /^(\d{1,2}):(\d{2})/.exec(texto ?? "");
    return partes ? Number(partes[1]) * 60 + Number(partes[2]) : null;
  };
  const a = leer(inicio);
  const b = leer(fin);
  return a === null || b === null ? null : b - a;
}

/** «2 h 30 min», «45 min», «3 h». */
export function duracion(minutos) {
  if (minutos === null || minutos === undefined || minutos <= 0) return "";
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (!horas) return `${resto} min`;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** «08:00 a 10:30», o "" si falta alguna hora (nunca « a » vacío). */
export function horario(desde, hasta) {
  if (!desde || !hasta) return "";
  return `${desde.slice(0, 5)} a ${hasta.slice(0, 5)}`;
}

/** Lo que dura una solicitud: «5 días», «1 día» o, por horas, «2 h 30 min». */
export function duracionDeSolicitud(s) {
  if (s.unidad === "horas") {
    return duracion(s.minutos ?? minutosEntre(s.hora_desde, s.hora_hasta));
  }
  return `${s.dias} ${s.dias === 1 ? "día" : "días"}`;
}
