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
