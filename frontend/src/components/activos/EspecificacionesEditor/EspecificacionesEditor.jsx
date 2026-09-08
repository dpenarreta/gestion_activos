import { useState } from "react";

/**
 * Editor de las especificaciones de hardware, como pares clave/valor libres.
 *
 * El backend las guarda en un campo JSON sin esquema fijo porque cada tipo de
 * equipo describe cosas distintas: una laptop tiene RAM y disco, una
 * impresora tiene resolución y tipo de tóner. Un formulario con campos fijos
 * obligaría a migrar la tabla cada vez que aparece una característica nueva,
 * y dejaría columnas vacías en la mayoría de los equipos.
 *
 * Se ofrecen sugerencias de nombres frecuentes en el `datalist`: sin ellas,
 * la misma característica terminaría escrita como "RAM", "Ram" y "Memoria
 * RAM" en tres equipos, que es la dispersión que el sistema viene a eliminar.
 */
const SUGERENCIAS = [
  "Procesador",
  "RAM",
  "Disco",
  "Tarjeta de video",
  "Sistema operativo",
  "Pantalla",
  "Resolución",
  "Conectividad",
  "Puertos",
];

export function EspecificacionesEditor({ valor = {}, onChange }) {
  const [clave, setClave] = useState("");
  const [contenido, setContenido] = useState("");

  const entradas = Object.entries(valor);

  function agregar() {
    const claveLimpia = clave.trim();
    if (!claveLimpia || !contenido.trim()) {
      return;
    }
    onChange({ ...valor, [claveLimpia]: contenido.trim() });
    setClave("");
    setContenido("");
  }

  function eliminar(claveAEliminar) {
    const copia = { ...valor };
    delete copia[claveAEliminar];
    onChange(copia);
  }

  return (
    <div className="especificaciones-editor">
      {entradas.length > 0 && (
        <div className="table-responsive mb-3">
          <table className="table table-sm align-middle mb-0">
            <thead>
              <tr>
                <th>Característica</th>
                <th>Valor</th>
                <th className="text-end">Quitar</th>
              </tr>
            </thead>
            <tbody>
              {entradas.map(([nombre, dato]) => (
                <tr key={nombre}>
                  <td>{nombre}</td>
                  <td>{String(dato)}</td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      onClick={() => eliminar(nombre)}
                      aria-label={`Quitar ${nombre}`}
                    >
                      <i className="bi bi-x-lg" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row g-2 align-items-end">
        <div className="col-md-4">
          <label className="form-label" htmlFor="espec-clave">
            Característica
          </label>
          <input
            id="espec-clave"
            className="form-control"
            list="especificaciones-sugeridas"
            placeholder="Procesador"
            value={clave}
            onChange={(event) => setClave(event.target.value)}
            // Enter dentro de este campo agrega la fila en vez de enviar el
            // formulario entero, que descartaría lo escrito.
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                agregar();
              }
            }}
          />
          <datalist id="especificaciones-sugeridas">
            {SUGERENCIAS.map((sugerencia) => (
              <option key={sugerencia} value={sugerencia} />
            ))}
          </datalist>
        </div>
        <div className="col-md-6">
          <label className="form-label" htmlFor="espec-valor">
            Valor
          </label>
          <input
            id="espec-valor"
            className="form-control"
            placeholder="Intel Core i5-1335U"
            value={contenido}
            onChange={(event) => setContenido(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                agregar();
              }
            }}
          />
        </div>
        <div className="col-md-2">
          <button
            type="button"
            className="btn btn-outline-primary w-100"
            onClick={agregar}
            disabled={!clave.trim() || !contenido.trim()}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
