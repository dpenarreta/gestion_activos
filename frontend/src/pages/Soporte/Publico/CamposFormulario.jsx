/*
 * Los campos del formulario público, como los configuró la empresa (menú Mesa
 * de ayuda → Formulario). Los pinta el formulario de verdad y la vista previa
 * del editor, así que lo que se ve al configurar es lo que verá el empleado.
 */

/** El formulario de siempre: lo que se muestra si el servidor no manda campos. */
export const CAMPOS_BASE = [
  ["nombre", "Nombre y apellido", "texto"],
  ["telefono", "Teléfono de contacto", "telefono"],
  ["correo", "Correo", "correo"],
  ["sede", "Agencia", "lista"],
  ["area", "Área", "lista"],
  ["categoria", "Categoría", "lista"],
  ["caso", "Caso de ayuda", "lista"],
  ["descripcion", "Describa el problema", "parrafo"],
  ["impacto", "¿A quién afecta?", "lista"],
  ["urgencia", "¿Puede seguir trabajando?", "lista"],
].map(([clave, etiqueta, tipo]) => ({
  clave,
  etiqueta,
  tipo,
  ayuda: "",
  opciones: [],
  obligatorio: true,
  base: true,
  categorias: [],
}));

const ANCHOS = new Set(["parrafo", "casilla", "correo"]);

/** Las respuestas de la matriz de prioridad, si el servidor no las manda. */
const IMPACTOS = [
  { id: "bajo", nombre: "Solo a mí" },
  { id: "medio", nombre: "A mi área o grupo de trabajo" },
  { id: "alto", nombre: "A toda la agencia, la sucursal o la empresa" },
];
const URGENCIAS = [
  { id: "alta", nombre: "No, la operación está detenida" },
  { id: "media", nombre: "Sí, pero con dificultad" },
  { id: "baja", nombre: "Sí, puede esperar" },
];

/** Si un campo propio aplica a la categoría elegida (sin filtro: siempre). */
export function aplica(campo, categoria) {
  if (campo.base || !campo.categorias?.length) return true;
  return campo.categorias.map(String).includes(String(categoria));
}

function Ayuda({ campo, porDefecto = "" }) {
  const texto = campo.ayuda || porDefecto;
  return texto ? <div className="form-text">{texto}</div> : null;
}

function Lista({ id, campo, valor, onCambiar, opciones, vacio, disabled }) {
  return (
    <select
      id={id}
      className="form-select"
      required={campo.obligatorio}
      disabled={disabled}
      value={valor}
      onChange={(e) => onCambiar(e.target.value)}
    >
      <option value="">{vacio}</option>
      {opciones.map(([v, etiqueta]) => (
        <option key={v} value={v}>
          {etiqueta}
        </option>
      ))}
    </select>
  );
}

/** El control de un campo del sistema: sus opciones salen de la empresa. */
function ControlBase({ campo, id, datos, valores, onBase }) {
  const valor = valores[campo.clave] ?? "";
  const cambiar = (v) => onBase(campo.clave, v);
  const categoria = datos.categorias.find(
    (c) => String(c.id) === String(valores.categoria),
  );
  switch (campo.clave) {
    case "sede":
      return (
        <Lista
          id={id}
          campo={campo}
          valor={valor}
          onCambiar={cambiar}
          vacio="Elija su agencia"
          opciones={datos.agencias.map((a) => [a.id, a.nombre])}
        />
      );
    case "impacto":
    case "urgencia": {
      const opciones =
        campo.clave === "impacto"
          ? (datos.impactos ?? IMPACTOS)
          : (datos.urgencias ?? URGENCIAS);
      return (
        <Lista
          id={id}
          campo={campo}
          valor={valor}
          onCambiar={cambiar}
          vacio="Elija una opción"
          opciones={opciones.map((o) => [o.id, o.nombre])}
        />
      );
    }
    case "area":
      return (
        <Lista
          id={id}
          campo={campo}
          valor={valor}
          onCambiar={cambiar}
          vacio="Elija su área"
          opciones={datos.areas.map((a) => [a.id, a.nombre])}
        />
      );
    case "categoria":
      return (
        <Lista
          id={id}
          campo={campo}
          valor={valor}
          onCambiar={cambiar}
          vacio="Elija la categoría"
          opciones={datos.categorias.map((c) => [c.id, c.nombre])}
        />
      );
    case "caso": {
      const caso = categoria?.casos.find((c) => String(c.id) === String(valor));
      return (
        <>
          <Lista
            id={id}
            campo={campo}
            valor={valor}
            onCambiar={cambiar}
            disabled={!categoria}
            vacio={categoria ? "Elija el caso" : "Primero la categoría"}
            opciones={(categoria?.casos ?? []).map((c) => [c.id, c.nombre])}
          />
          {caso && (
            <div className="form-text">Prioridad: {caso.prioridad_display}</div>
          )}
        </>
      );
    }
    case "descripcion":
      return (
        <textarea
          id={id}
          className="form-control"
          rows={4}
          required
          maxLength={5000}
          value={valor}
          onChange={(e) => cambiar(e.target.value)}
        />
      );
    default: {
      const tipos = { correo: "email", telefono: "tel" };
      return (
        <input
          id={id}
          type={tipos[campo.tipo] ?? "text"}
          className="form-control"
          required={campo.obligatorio}
          maxLength={campo.clave === "nombre" ? 150 : undefined}
          autoComplete={
            { nombre: "name", telefono: "tel", correo: "email" }[campo.clave]
          }
          inputMode={campo.tipo === "telefono" ? "tel" : undefined}
          value={valor}
          onChange={(e) => cambiar(e.target.value)}
        />
      );
    }
  }
}

/** El control de un campo propio, según su tipo. */
export function ControlPropio({ campo, id, valor, onCambiar }) {
  const comun = {
    id,
    required: campo.obligatorio,
    onChange: (e) => onCambiar(e.target.value),
  };
  switch (campo.tipo) {
    case "parrafo":
      return (
        <textarea
          {...comun}
          className="form-control"
          rows={3}
          maxLength={2000}
          value={valor ?? ""}
        />
      );
    case "lista":
      return (
        <select {...comun} className="form-select" value={valor ?? ""}>
          <option value="">Elija una opción</option>
          {campo.opciones.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "casilla":
      return (
        <input
          id={id}
          type="checkbox"
          className="form-check-input"
          required={campo.obligatorio}
          checked={Boolean(valor)}
          onChange={(e) => onCambiar(e.target.checked)}
        />
      );
    default: {
      const tipos = {
        numero: "number",
        fecha: "date",
        correo: "email",
        telefono: "tel",
      };
      return (
        <input
          {...comun}
          type={tipos[campo.tipo] ?? "text"}
          className="form-control"
          step={campo.tipo === "numero" ? "any" : undefined}
          maxLength={campo.tipo === "texto" ? 200 : undefined}
          value={valor ?? ""}
        />
      );
    }
  }
}

/**
 * Pinta los campos en su orden. `valores` son los del sistema y `adicionales`
 * los propios (clave → valor). Un campo propio limitado a ciertas categorías
 * aparece solo al elegir una de ellas.
 */
export function CamposFormulario({
  campos,
  datos,
  valores,
  onBase,
  adicionales,
  onAdicional,
  prefijo = "sp",
}) {
  return (campos?.length ? campos : CAMPOS_BASE)
    .filter((campo) => aplica(campo, valores.categoria))
    .map((campo) => {
      const id = `${prefijo}-${campo.clave}`;
      const ancho =
        ANCHOS.has(campo.tipo) || campo.clave === "descripcion"
          ? "col-12"
          : "col-12 col-md-6";
      if (!campo.base && campo.tipo === "casilla") {
        return (
          <div key={campo.clave} className="col-12">
            <div className="form-check">
              <ControlPropio
                campo={campo}
                id={id}
                valor={adicionales[campo.clave]}
                onCambiar={(v) => onAdicional(campo.clave, v)}
              />
              <label className="form-check-label" htmlFor={id}>
                {campo.etiqueta}
              </label>
            </div>
            <Ayuda campo={campo} />
          </div>
        );
      }
      return (
        <div key={campo.clave} className={ancho}>
          <label className="form-label" htmlFor={id}>
            {campo.etiqueta}
            {!campo.obligatorio && (
              <span className="mz-faint fw-normal"> (opcional)</span>
            )}
          </label>
          {campo.base ? (
            <ControlBase
              campo={campo}
              id={id}
              datos={datos}
              valores={valores}
              onBase={onBase}
            />
          ) : (
            <ControlPropio
              campo={campo}
              id={id}
              valor={adicionales[campo.clave]}
              onCambiar={(v) => onAdicional(campo.clave, v)}
            />
          )}
          <Ayuda
            campo={campo}
            porDefecto={
              campo.clave === "correo"
                ? "Aquí le llegan el enlace de seguimiento y los avisos."
                : ""
            }
          />
        </div>
      );
    });
}
