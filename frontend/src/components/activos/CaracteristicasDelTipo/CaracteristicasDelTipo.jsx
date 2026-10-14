import { useEffect, useState } from "react";

import { caracteristicasService } from "../../../api/activosService";
import { Icon } from "../../common/Icon/Icon";
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
  ["texto_ampliado", "Texto ampliado"],
  ["numero", "Número"],
  ["entero", "Número entero"],
  ["booleano", "Sí / No"],
  ["lista", "Lista de opciones"],
  ["fecha", "Fecha"],
];

/** Las opciones se escriben una por línea: es como se piensa una lista, y
 *  evita elegir un separador que algún valor podría contener. */
function conOpciones(valor) {
  return valor
    .split("\n")
    .map((opcion) => opcion.trim())
    .filter(Boolean);
}

/** De lo guardado al formulario: las opciones vuelven a ser texto editable. */
function comoFormulario(caracteristica) {
  return {
    nombre: caracteristica.nombre,
    unidad: caracteristica.unidad || "",
    dato: caracteristica.dato,
    opciones: (caracteristica.opciones || []).join("\n"),
    obligatoria: Boolean(caracteristica.obligatoria),
    orden: caracteristica.orden ?? 0,
  };
}

/** Del formulario a lo que entiende la API. */
function comoEnvio(valores) {
  return {
    ...valores,
    nombre: valores.nombre.trim(),
    opciones: valores.dato === "lista" ? conOpciones(valores.opciones) : [],
    orden: Number(valores.orden) || 0,
  };
}

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
 *
 * Mientras el tipo no existe —se está creando ahora mismo— no hay dónde
 * colgarlas, así que se acumulan aquí y viajan con el tipo en el mismo envío.
 * Es lo que evita que un tipo recién creado entre al desplegable sin declarar
 * nada: los primeros equipos que se carguen por ahí lo harían con
 * características libres, que es la dispersión que esto viene a eliminar.
 */
export function CaracteristicasDelTipo({
  tipo,
  puedeEditar,
  borrador = [],
  onBorradorChange,
}) {
  const enBorrador = !tipo?.id;
  const [guardadas, setGuardadas] = useState([]);
  const caracteristicas = enBorrador ? borrador : guardadas;
  const [nueva, setNueva] = useState(VACIA);
  // Qué fila se está corrigiendo y con qué valores. Se corrige en su sitio y no
  // en un diálogo aparte: son los mismos seis campos con los que se declaró.
  const [edicion, setEdicion] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!tipo?.id) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    caracteristicasService
      .list({ tipo: tipo.id, page_size: 100 })
      .then((datos) => setGuardadas(datos.results ?? []))
      .catch(() => setError("No se pudieron cargar las características."))
      .finally(() => setIsLoading(false));
  }, [tipo?.id]);

  /** Lo que no puede pasar, se esté declarando o corrigiendo. */
  function loQueNoPuedeSer(valores, exceptoPosicion = null) {
    if (!valores.nombre) return "La característica necesita un nombre.";
    const choque = caracteristicas.find(
      (c, indice) =>
        indice !== exceptoPosicion &&
        c.nombre.toLowerCase() === valores.nombre.toLowerCase(),
    );
    if (choque) {
      return `«${valores.nombre}» repite a «${choque.nombre}». Dos características con el mismo nombre guardarían su valor en el mismo sitio.`;
    }
    if (valores.dato === "lista" && valores.opciones.length === 0) {
      return "Una lista de opciones necesita al menos una opción.";
    }
    return null;
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

    const declarada = comoEnvio(nueva);
    const problema = loQueNoPuedeSer(declarada);
    if (problema) {
      setError(problema);
      return;
    }

    if (enBorrador) {
      onBorradorChange([...borrador, { ...declarada, activa: true }]);
      setNueva(VACIA);
      return;
    }

    try {
      const creada = await caracteristicasService.create({
        tipo: tipo.id,
        ...declarada,
      });
      setGuardadas((actuales) => [...actuales, creada]);
      setNueva(VACIA);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo añadir la característica."));
    }
  }

  async function guardarEdicion() {
    setError(null);
    const corregida = comoEnvio(edicion.valores);
    const problema = loQueNoPuedeSer(corregida, edicion.posicion);
    if (problema) {
      setError(problema);
      return;
    }

    if (enBorrador) {
      onBorradorChange(
        borrador.map((c, indice) =>
          indice === edicion.posicion ? { ...corregida, activa: true } : c,
        ),
      );
      setEdicion(null);
      return;
    }

    try {
      // Renombrarla arrastra lo que los equipos ya tuvieran guardado bajo el
      // nombre anterior —lo hace el modelo al guardar—, así que corregir una
      // errata no hace perder el inventario de esa característica.
      const actualizada = await caracteristicasService.update(
        edicion.id,
        corregida,
      );
      setGuardadas((actuales) =>
        actuales.map((c) => (c.id === actualizada.id ? actualizada : c)),
      );
      setEdicion(null);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la característica."));
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
      setGuardadas((actuales) =>
        actuales.map((c) => (c.id === actualizada.id ? actualizada : c)),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo cambiar la característica."));
    }
  }

  async function quitar(caracteristica, posicion) {
    setError(null);
    if (enBorrador) {
      onBorradorChange(borrador.filter((_, indice) => indice !== posicion));
      return;
    }
    try {
      await caracteristicasService.remove(caracteristica.id);
      setGuardadas((actuales) =>
        actuales.filter((c) => c.id !== caracteristica.id),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo quitar la característica."));
    }
  }

  return (
    <div className="caracteristicas-tipo">
      <p className="mz-faint">
        Lo que se declara aquí es lo que se pide al registrar un equipo de tipo{" "}
        <strong>{tipo?.nombre || "este tipo"}</strong>. Mientras no haya
        ninguna, el formulario sigue admitiendo características libres.
        {enBorrador && " Se crearán junto con el tipo al guardarlo."}
      </p>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-table-wrap mb-3">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Característica</th>
              <th>Dato</th>
              <th>Unidad</th>
              <th className="text-center">Obligatoria</th>
              <th className="num">Orden</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {caracteristicas.map((caracteristica, posicion) =>
              edicion?.posicion === posicion ? (
                <tr key={caracteristica.id ?? `borrador-${posicion}`}>
                  {/* De ancho completo y no campo por celda: seis controles
                      repartidos en las columnas de una tabla, dentro de un
                      diálogo de 34rem, quedan ilegibles. */}
                  <td colSpan={6}>
                    <CamposDeCaracteristica
                      prefijo={`carac-edicion-${posicion}`}
                      valores={edicion.valores}
                      onChange={(valores) =>
                        setEdicion({ ...edicion, valores })
                      }
                    />
                    <div className="d-flex gap-2 mt-2">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={guardarEdicion}
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => {
                          setEdicion(null);
                          setError(null);
                        }}
                      >
                        {/* «Descartar» y no «Cancelar»: el pie del diálogo ya
                            tiene un «Cancelar» que cierra el tipo entero, y dos
                            botones con el mismo nombre y distinto alcance a la
                            vista se confunden justo cuando hay trabajo sin
                            guardar. */}
                        Descartar
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  // En borrador todavía no hay identificador: la posición es lo
                  // único que las distingue, y como solo se añaden al final y se
                  // quitan enteras, no reordena filas ajenas.
                  key={caracteristica.id ?? `borrador-${posicion}`}
                  className={caracteristica.activa ? "" : "mz-faint"}
                >
                  <td>
                    {caracteristica.nombre}
                    {!caracteristica.activa && (
                      <span className="mz-pill mz-pill--neutral ms-2">
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
                    {
                      DATOS.find(
                        ([clave]) => clave === caracteristica.dato,
                      )?.[1]
                    }
                  </td>
                  <td>{caracteristica.unidad || "—"}</td>
                  <td className="text-center">
                    {caracteristica.obligatoria ? "Sí" : "—"}
                  </td>
                  <td className="num">{caracteristica.orden}</td>
                  <td>
                    {puedeEditar && (
                      <div className="d-flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-primary btn-sm"
                          onClick={() => {
                            setError(null);
                            setEdicion({
                              posicion,
                              id: caracteristica.id,
                              valores: comoFormulario(caracteristica),
                            });
                          }}
                        >
                          Editar
                        </button>
                        {/* «Dejar de pedir» conserva lo ya capturado en los
                            equipos, y en una que todavía no existe no hay nada
                            que conservar: ahí quitarla es la operación entera. */}
                        {!enBorrador && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => alternarActiva(caracteristica)}
                          >
                            {caracteristica.activa
                              ? "Dejar de pedir"
                              : "Volver a pedir"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => quitar(caracteristica, posicion)}
                        >
                          Quitar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ),
            )}
            {!isLoading && caracteristicas.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={6}>
                  Este tipo todavía no declara ninguna característica
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {puedeEditar && (
        <form onSubmit={agregar}>
          <CamposDeCaracteristica
            prefijo="carac"
            valores={nueva}
            onChange={setNueva}
            accion={
              <button type="submit" className="btn btn-primary btn-sm w-100">
                Añadir
              </button>
            }
          />
        </form>
      )}
    </div>
  );
}

/**
 * Los campos con los que se declara una característica.
 *
 * Los mismos para añadirla y para corregirla: si fueran dos formularios,
 * cualquier campo nuevo entraría en uno y no en el otro, y la corrección
 * terminaría ofreciendo menos de lo que ofrece el alta.
 *
 * Dos renglones y no uno: la rejilla de Bootstrap se decide por el ancho de la
 * ventana, pero esto vive dentro de un diálogo de 34rem. Repartir seis
 * controles en una sola fila dejaba el desplegable cortado y «Obligatoria»
 * encima del botón en cuanto la ventana pasaba de 768px, que es el caso normal.
 */
function CamposDeCaracteristica({ prefijo, valores, onChange, accion = null }) {
  function fijar(campo, valor) {
    onChange({ ...valores, [campo]: valor });
  }

  return (
    <div className="row g-2 align-items-end">
      <div className={accion ? "col-12 col-md-5" : "col-12 col-md-6"}>
        <label className="form-label" htmlFor={`${prefijo}-nombre`}>
          Característica
        </label>
        <input
          id={`${prefijo}-nombre`}
          className="form-control form-control-sm"
          required
          maxLength={80}
          placeholder="RAM"
          value={valores.nombre}
          onChange={(e) => fijar("nombre", e.target.value)}
        />
      </div>
      <div className={accion ? "col-7 col-md-4" : "col-7 col-md-3"}>
        <label className="form-label" htmlFor={`${prefijo}-dato`}>
          Dato
        </label>
        <select
          id={`${prefijo}-dato`}
          className="form-select form-select-sm"
          value={valores.dato}
          onChange={(e) => fijar("dato", e.target.value)}
        >
          {DATOS.map(([clave, etiqueta]) => (
            <option key={clave} value={clave}>
              {etiqueta}
            </option>
          ))}
        </select>
      </div>
      <div className="col-5 col-md-3">
        <label className="form-label" htmlFor={`${prefijo}-unidad`}>
          Unidad
        </label>
        <input
          id={`${prefijo}-unidad`}
          className="form-control form-control-sm"
          maxLength={20}
          placeholder="GB"
          value={valores.unidad}
          onChange={(e) => fijar("unidad", e.target.value)}
        />
      </div>
      <div className="col-4 col-md-3">
        <label className="form-label" htmlFor={`${prefijo}-orden`}>
          Orden
        </label>
        <input
          id={`${prefijo}-orden`}
          type="number"
          min="0"
          className="form-control form-control-sm"
          value={valores.orden}
          onChange={(e) => fijar("orden", e.target.value)}
        />
      </div>
      <div className={accion ? "col-8 col-md-5" : "col-8 col-md-9"}>
        <div className="form-check pb-1">
          <input
            id={`${prefijo}-obligatoria`}
            type="checkbox"
            className="form-check-input"
            checked={valores.obligatoria}
            onChange={(e) => fijar("obligatoria", e.target.checked)}
          />
          <label
            className="form-check-label"
            htmlFor={`${prefijo}-obligatoria`}
          >
            Obligatoria
          </label>
        </div>
      </div>
      {accion && <div className="col-12 col-md-4">{accion}</div>}

      {valores.dato === "lista" && (
        <div className="col-12">
          <label className="form-label" htmlFor={`${prefijo}-opciones`}>
            Opciones admitidas
          </label>
          <textarea
            id={`${prefijo}-opciones`}
            className="form-control form-control-sm"
            rows={3}
            placeholder={"Windows 11\nUbuntu 22.04"}
            value={valores.opciones}
            onChange={(e) => fijar("opciones", e.target.value)}
          />
          <div className="form-text">
            Una por línea. Solo se admitirán esas al describir el equipo.
          </div>
        </div>
      )}
    </div>
  );
}
