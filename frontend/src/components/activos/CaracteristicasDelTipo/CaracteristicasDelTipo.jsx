import { useEffect, useState } from "react";

import { caracteristicasService } from "../../../api/activosService";
import { mensajeDeError } from "../../../utils/errores";
import "./CaracteristicasDelTipo.css";

const VACIA = {
  nombre: "",
  unidad: "",
  dato: "texto",
  opciones: "",
  obligatoria: false,
  orden: 0,
};

const DATOS = [
  ["texto", "Texto"],
  ["numero", "Número"],
  ["entero", "Número entero"],
  ["booleano", "Sí / No"],
  ["lista", "Lista de opciones"],
  ["fecha", "Fecha"],
];

/**
 * Qué se describe de este tipo de equipo.
 *
 * Una laptop pide procesador, RAM y disco; una cámara, resolución y lente. Lo
 * que se declara aquí es lo que el formulario del activo va a ofrecer, y desde
 * ese momento deja de aceptar cualquier otra cosa: es lo que impide que la
 * misma característica termine escrita de tres maneras en equipos del mismo
 * modelo.
 *
 * Se editan de a una y no como una lista que se guarda entera: añadir
 * «Resolución» a las cámaras no debería obligar a reenviar las otras cinco ni
 * arriesgarse a pisarlas.
 */
export function CaracteristicasDelTipo({ tipo, puedeEditar }) {
  const [caracteristicas, setCaracteristicas] = useState([]);
  const [nueva, setNueva] = useState(VACIA);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!tipo?.id) return;
    setIsLoading(true);
    caracteristicasService
      .list({ tipo: tipo.id, page_size: 100 })
      .then((datos) => setCaracteristicas(datos.results ?? []))
      .catch(() => setError("No se pudieron cargar las características."))
      .finally(() => setIsLoading(false));
  }, [tipo?.id]);

  function conOpciones(valor) {
    // Se escriben una por línea: es como se piensa una lista, y evita el
    // problema de elegir un separador que algún valor podría contener.
    return valor
      .split("\n")
      .map((opcion) => opcion.trim())
      .filter(Boolean);
  }

  async function agregar(evento) {
    evento.preventDefault();
    // Este formulario se dibuja dentro del diálogo del tipo, que también es un
    // formulario. Sin cortar la propagación, añadir una característica
    // dispararía además el guardado del tipo y el diálogo se cerraría en mitad
    // del trabajo —justo cuando se están declarando varias seguidas—, sin
    // llegar a mostrar el error si la característica se rechaza.
    evento.stopPropagation();
    setError(null);
    try {
      const creada = await caracteristicasService.create({
        tipo: tipo.id,
        ...nueva,
        opciones: nueva.dato === "lista" ? conOpciones(nueva.opciones) : [],
        orden: Number(nueva.orden) || 0,
      });
      setCaracteristicas((actuales) => [...actuales, creada]);
      setNueva(VACIA);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo añadir la característica."));
    }
  }

  async function alternarActiva(caracteristica) {
    setError(null);
    try {
      const actualizada = await caracteristicasService.update(
        caracteristica.id,
        {
          activa: !caracteristica.activa,
        },
      );
      setCaracteristicas((actuales) =>
        actuales.map((c) => (c.id === actualizada.id ? actualizada : c)),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo cambiar la característica."));
    }
  }

  async function quitar(caracteristica) {
    setError(null);
    try {
      await caracteristicasService.remove(caracteristica.id);
      setCaracteristicas((actuales) =>
        actuales.filter((c) => c.id !== caracteristica.id),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo quitar la característica."));
    }
  }

  return (
    <div className="caracteristicas-tipo">
      <p className="text-muted">
        Lo que se declara aquí es lo que se pide al registrar un equipo de tipo{" "}
        <strong>{tipo?.nombre}</strong>. Mientras no haya ninguna, el formulario
        sigue admitiendo características libres.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Característica</th>
              <th>Dato</th>
              <th>Unidad</th>
              <th className="text-center">Obligatoria</th>
              <th className="text-center">Orden</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {caracteristicas.map((caracteristica) => (
              <tr
                key={caracteristica.id}
                className={caracteristica.activa ? "" : "text-muted"}
              >
                <td>
                  {caracteristica.nombre}
                  {!caracteristica.activa && (
                    <span className="badge text-bg-secondary ms-2">
                      Ya no se pide
                    </span>
                  )}
                  {caracteristica.dato === "lista" && (
                    <div className="form-text">
                      {caracteristica.opciones.join(" · ")}
                    </div>
                  )}
                </td>
                <td>
                  {DATOS.find(([clave]) => clave === caracteristica.dato)?.[1]}
                </td>
                <td>{caracteristica.unidad || "—"}</td>
                <td className="text-center">
                  {caracteristica.obligatoria ? "Sí" : "—"}
                </td>
                <td className="text-center">{caracteristica.orden}</td>
                <td>
                  {puedeEditar && (
                    <div className="d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => alternarActiva(caracteristica)}
                      >
                        {caracteristica.activa
                          ? "Dejar de pedir"
                          : "Volver a pedir"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => quitar(caracteristica)}
                      >
                        Quitar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && caracteristicas.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted">
                  Este tipo todavía no declara ninguna característica
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {puedeEditar && (
        <form className="row g-2 align-items-end" onSubmit={agregar}>
          <div className="col-md-3">
            <label className="form-label" htmlFor="carac-nombre">
              Característica
            </label>
            <input
              id="carac-nombre"
              className="form-control form-control-sm"
              required
              maxLength={80}
              placeholder="RAM"
              value={nueva.nombre}
              onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })}
            />
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="carac-dato">
              Dato
            </label>
            <select
              id="carac-dato"
              className="form-select form-select-sm"
              value={nueva.dato}
              onChange={(e) => setNueva({ ...nueva, dato: e.target.value })}
            >
              {DATOS.map(([clave, etiqueta]) => (
                <option key={clave} value={clave}>
                  {etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-2">
            <label className="form-label" htmlFor="carac-unidad">
              Unidad
            </label>
            <input
              id="carac-unidad"
              className="form-control form-control-sm"
              maxLength={20}
              placeholder="GB"
              value={nueva.unidad}
              onChange={(e) => setNueva({ ...nueva, unidad: e.target.value })}
            />
          </div>
          <div className="col-md-1">
            <label className="form-label" htmlFor="carac-orden">
              Orden
            </label>
            <input
              id="carac-orden"
              type="number"
              min="0"
              className="form-control form-control-sm"
              value={nueva.orden}
              onChange={(e) => setNueva({ ...nueva, orden: e.target.value })}
            />
          </div>
          <div className="col-md-2">
            <div className="form-check">
              <input
                id="carac-obligatoria"
                type="checkbox"
                className="form-check-input"
                checked={nueva.obligatoria}
                onChange={(e) =>
                  setNueva({ ...nueva, obligatoria: e.target.checked })
                }
              />
              <label className="form-check-label" htmlFor="carac-obligatoria">
                Obligatoria
              </label>
            </div>
          </div>
          <div className="col-md-2">
            <button type="submit" className="btn btn-primary btn-sm w-100">
              Añadir
            </button>
          </div>

          {nueva.dato === "lista" && (
            <div className="col-12">
              <label className="form-label" htmlFor="carac-opciones">
                Opciones admitidas
              </label>
              <textarea
                id="carac-opciones"
                className="form-control form-control-sm"
                rows={3}
                placeholder={"Windows 11\nUbuntu 22.04"}
                value={nueva.opciones}
                onChange={(e) =>
                  setNueva({ ...nueva, opciones: e.target.value })
                }
              />
              <div className="form-text">
                Una por línea. Solo se admitirán esas al describir el equipo.
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
