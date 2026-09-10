import "./EspecificacionesDelTipo.css";

/**
 * Las características que el tipo de equipo declara, como campos del formulario.
 *
 * Sustituye a los pares clave/valor libres en cuanto el tipo describe algo: una
 * laptop pide procesador, RAM y disco; una cámara, resolución y lente. Con
 * campos declarados, la misma característica ya no puede escribirse como «RAM»,
 * «Ram» y «Memoria RAM» en tres equipos del mismo modelo, que es lo que hacía
 * inútil filtrar o comparar por ellas.
 *
 * Cada dato se pide como lo que es —un número con su unidad al lado, una lista
 * con sus opciones, un sí/no— en vez de con una casilla de texto para todo: es
 * lo que evita que «8», «8 GB» y «ocho» convivan en el mismo campo.
 */
export function EspecificacionesDelTipo({
  caracteristicas,
  valor = {},
  onChange,
  heredadas = [],
}) {
  function fijar(nombre, contenido) {
    const siguiente = { ...valor };
    if (contenido === "" || contenido === null) {
      delete siguiente[nombre];
    } else {
      siguiente[nombre] = contenido;
    }
    onChange(siguiente);
  }

  return (
    <div className="especificaciones-tipo">
      <div className="row g-3">
        {caracteristicas.map((caracteristica) => (
          <div className="col-md-6" key={caracteristica.id}>
            <label
              className="form-label"
              htmlFor={`espec-${caracteristica.id}`}
            >
              {caracteristica.nombre}
              {/* `{" "}` explícito: JSX recorta el espacio que abre una línea,
                  y sin él se lee «Lente(mm)» y «Resolución*». */}
              {caracteristica.unidad && (
                <>
                  {" "}
                  <span className="text-muted">({caracteristica.unidad})</span>
                </>
              )}
              {caracteristica.obligatoria && (
                <>
                  {" "}
                  <span
                    className="especificaciones-tipo__obligatoria"
                    title="Obligatoria para este tipo de equipo"
                  >
                    *
                  </span>
                </>
              )}
            </label>
            <Campo
              caracteristica={caracteristica}
              valor={valor[caracteristica.nombre]}
              onChange={(contenido) => fijar(caracteristica.nombre, contenido)}
            />
          </div>
        ))}
      </div>

      {heredadas.length > 0 && (
        <div className="mt-3">
          {/* Un equipo cargado antes de que el tipo se describiera arrastra
              características que ya nadie declara. Se muestran y se conservan:
              borrarlas al guardar haría perder datos que alguien capturó, y
              esconderlas haría creer que el equipo no los tiene. */}
          <h6 className="text-uppercase text-muted small">
            Características anteriores
          </h6>
          <p className="form-text mb-2">
            Este equipo las tenía antes de que el tipo declarara las suyas. Se
            conservan tal como están; para dejar de verlas aquí, añádalas al
            tipo o bórrelas del equipo.
          </p>
          <dl className="especificaciones-tipo__heredadas">
            {heredadas.map(([nombre, contenido]) => (
              <div key={nombre}>
                <dt>{nombre}</dt>
                <dd>
                  {String(contenido)}
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm ms-2"
                    onClick={() => fijar(nombre, "")}
                  >
                    Quitar
                  </button>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function Campo({ caracteristica, valor, onChange }) {
  const id = `espec-${caracteristica.id}`;
  const comun = {
    id,
    className: "form-control",
    required: caracteristica.obligatoria,
    value: valor ?? "",
    onChange: (evento) => onChange(evento.target.value),
  };

  if (caracteristica.dato === "lista") {
    return (
      <select {...comun} className="form-select">
        <option value="">Sin especificar</option>
        {caracteristica.opciones.map((opcion) => (
          <option key={opcion} value={opcion}>
            {opcion}
          </option>
        ))}
      </select>
    );
  }

  if (caracteristica.dato === "booleano") {
    return (
      <select
        {...comun}
        className="form-select"
        value={valor === true ? "true" : valor === false ? "false" : ""}
        onChange={(evento) =>
          onChange(
            evento.target.value === "" ? "" : evento.target.value === "true",
          )
        }
      >
        <option value="">Sin especificar</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (caracteristica.dato === "fecha") {
    return <input {...comun} type="date" />;
  }

  if (caracteristica.dato === "numero" || caracteristica.dato === "entero") {
    return (
      <input
        {...comun}
        type="number"
        step={caracteristica.dato === "entero" ? "1" : "any"}
      />
    );
  }

  return <input {...comun} maxLength={200} />;
}
