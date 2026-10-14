import { useCallback, useEffect, useState } from "react";

import { columnasPlantillaService } from "../../../api/activosService";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./ColumnasPlantilla.css";

const PREFIJO_ESPECIFICACION = "espec:";

/**
 * Configuración de las columnas que pide la plantilla de carga masiva.
 *
 * Cinco columnas son estructurales —tipo, nombre, serie, departamento y
 * fecha— y aparecen bloqueadas: sin esos datos no se puede crear un activo, y
 * permitir quitarlas no daría flexibilidad sino un archivo que siempre falla.
 * El resto se activa, se vuelve obligatorio, se renombra y se reordena.
 */
export function ColumnasPlantillaPanel() {
  const puedeEditar = usePermission("activos.editar");
  const [columnas, setColumnas] = useState([]);
  const [campos, setCampos] = useState([]);
  const [enEdicion, setEnEdicion] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const cargar = useCallback(() => {
    setIsLoading(true);
    Promise.all([
      columnasPlantillaService.list(),
      columnasPlantillaService.camposDisponibles(),
    ])
      .then(([listaColumnas, listaCampos]) => {
        setColumnas(listaColumnas.results ?? listaColumnas);
        setCampos(listaCampos);
      })
      .catch(() =>
        setError("No se pudieron cargar las columnas de la plantilla."),
      )
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function alternar(columna, campo) {
    setError(null);
    try {
      await columnasPlantillaService.update(columna.id, {
        [campo]: !columna[campo],
      });
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo cambiar la columna."));
    }
  }

  async function mover(columna, direccion) {
    const indice = columnas.findIndex((c) => c.id === columna.id);
    const vecino = columnas[indice + direccion];
    if (!vecino) return;
    setError(null);
    try {
      // Se intercambian los órdenes en vez de renumerar toda la lista: dos
      // peticiones bastan y no se toca lo que el usuario no movió.
      await columnasPlantillaService.update(columna.id, {
        orden: vecino.orden,
      });
      await columnasPlantillaService.update(vecino.id, {
        orden: columna.orden,
      });
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo reordenar."));
    }
  }

  async function eliminar(columna) {
    setError(null);
    try {
      await columnasPlantillaService.remove(columna.id);
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo eliminar la columna."));
    }
  }

  if (isLoading) {
    return <div className="mz-empty">Cargando…</div>;
  }

  return (
    <section className="mz-card columnas-plantilla">
      <div className="mz-card-head">
        <p className="mz-desc mt-0">
          Define qué se pide en la plantilla y qué se lee al importar. Los
          cambios se aplican a la próxima descarga.
        </p>
        {puedeEditar && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEnEdicion({})}
          >
            <Icon name="plus-lg" /> Agregar columna
          </button>
        )}
      </div>

      {error && (
        <div className="mz-card-body pb-0">
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th className="columnas-plantilla__orden">Orden</th>
              <th>Columna</th>
              <th>Qué llena</th>
              <th className="text-center">Se pide</th>
              <th className="text-center">Obligatoria</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {columnas.map((columna, indice) => (
              <tr
                key={columna.id}
                className={columna.activa ? "" : "columna-inactiva"}
              >
                <td>
                  <div
                    className="btn-group btn-group-sm"
                    role="group"
                    aria-label="Reordenar"
                  >
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      disabled={!puedeEditar || indice === 0}
                      onClick={() => mover(columna, -1)}
                      aria-label={`Subir ${columna.etiqueta}`}
                    >
                      <Icon name="arrow-up" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      disabled={!puedeEditar || indice === columnas.length - 1}
                      onClick={() => mover(columna, 1)}
                      aria-label={`Bajar ${columna.etiqueta}`}
                    >
                      <Icon name="arrow-down" />
                    </button>
                  </div>
                </td>
                <td>
                  <span className="mz-strong">{columna.etiqueta}</span>
                  {columna.ayuda && (
                    <div className="mz-small mz-faint">{columna.ayuda}</div>
                  )}
                </td>
                <td>
                  {columna.es_especificacion ? (
                    <>
                      <span className="mz-pill mz-pill--neutral">
                        Especificación
                      </span>
                      <div className="mz-small mz-faint">
                        Se guarda como «
                        {columna.clave.slice(PREFIJO_ESPECIFICACION.length)}»
                      </div>
                    </>
                  ) : (
                    <code className="mz-code">{columna.clave}</code>
                  )}
                  {columna.es_estructural && (
                    <div className="mz-small mz-faint">
                      <Icon name="lock" className="me-1" />
                      Imprescindible para crear el activo
                    </div>
                  )}
                </td>
                <td className="text-center">
                  <Interruptor
                    activo={columna.activa}
                    bloqueado={!puedeEditar || columna.es_estructural}
                    etiqueta={`Pedir ${columna.etiqueta}`}
                    onCambiar={() => alternar(columna, "activa")}
                  />
                </td>
                <td className="text-center">
                  <Interruptor
                    activo={columna.obligatoria}
                    bloqueado={
                      !puedeEditar || columna.es_estructural || !columna.activa
                    }
                    etiqueta={`Hacer obligatoria ${columna.etiqueta}`}
                    onCambiar={() => alternar(columna, "obligatoria")}
                  />
                </td>
                <td className="acciones">
                  {puedeEditar && (
                    <>
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => setEnEdicion(columna)}
                      >
                        Editar
                      </button>
                      {!columna.es_estructural && (
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          onClick={() => eliminar(columna)}
                        >
                          Quitar
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {enEdicion && (
        <ColumnaDialog
          columna={enEdicion}
          campos={campos}
          onCerrar={() => setEnEdicion(null)}
          onGuardado={() => {
            setEnEdicion(null);
            cargar();
          }}
        />
      )}
    </section>
  );
}

function Interruptor({ activo, bloqueado, etiqueta, onCambiar }) {
  return (
    <div className="form-check form-switch d-inline-block m-0">
      <input
        type="checkbox"
        className="form-check-input"
        role="switch"
        checked={activo}
        disabled={bloqueado}
        aria-label={etiqueta}
        onChange={onCambiar}
      />
    </div>
  );
}

function ColumnaDialog({ columna, campos, onCerrar, onGuardado }) {
  const esEdicion = Boolean(columna.id);
  const [tipoColumna, setTipoColumna] = useState(
    columna.es_especificacion ? "especificacion" : "campo",
  );
  const [valores, setValores] = useState({
    clave: columna.clave || "",
    nombreEspecificacion: columna.es_especificacion
      ? columna.clave.slice(PREFIJO_ESPECIFICACION.length)
      : "",
    etiqueta: columna.etiqueta || "",
    ayuda: columna.ayuda || "",
    obligatoria: columna.obligatoria ?? false,
    activa: columna.activa ?? true,
    orden: columna.orden ?? 999,
  });
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const disponibles = campos.filter((campo) => !campo.en_uso);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const clave =
        tipoColumna === "especificacion"
          ? `${PREFIJO_ESPECIFICACION}${valores.nombreEspecificacion.trim()}`
          : valores.clave;
      const payload = {
        etiqueta: valores.etiqueta,
        ayuda: valores.ayuda,
        obligatoria: valores.obligatoria,
        activa: valores.activa,
        orden: Number(valores.orden) || 0,
      };
      if (esEdicion) {
        await columnasPlantillaService.update(columna.id, payload);
      } else {
        await columnasPlantillaService.create({ ...payload, clave });
      }
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la columna."));
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo={esEdicion ? "Editar columna" : "Agregar columna"}
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
    >
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {!esEdicion && (
        <>
          <div className="mb-3">
            <span className="form-label d-block">
              ¿Qué dato pide esta columna?
            </span>
            <div className="form-check">
              <input
                id="tipo-campo"
                className="form-check-input"
                type="radio"
                checked={tipoColumna === "campo"}
                onChange={() => setTipoColumna("campo")}
              />
              <label className="form-check-label" htmlFor="tipo-campo">
                Un campo del activo
              </label>
            </div>
            <div className="form-check">
              <input
                id="tipo-espec"
                className="form-check-input"
                type="radio"
                checked={tipoColumna === "especificacion"}
                onChange={() => setTipoColumna("especificacion")}
              />
              <label className="form-check-label" htmlFor="tipo-espec">
                Una característica propia (se guarda en las especificaciones del
                equipo)
              </label>
            </div>
          </div>

          {tipoColumna === "campo" ? (
            <div className="mz-field mb-3">
              <label htmlFor="col-clave">Campo</label>
              <select
                id="col-clave"
                className="form-select"
                required
                value={valores.clave}
                onChange={(event) => {
                  const campo = campos.find(
                    (c) => c.clave === event.target.value,
                  );
                  setValores({
                    ...valores,
                    clave: event.target.value,
                    etiqueta: valores.etiqueta || campo?.etiqueta || "",
                  });
                }}
              >
                <option value="">Seleccione un campo</option>
                {disponibles.map((campo) => (
                  <option key={campo.clave} value={campo.clave}>
                    {campo.etiqueta}
                  </option>
                ))}
              </select>
              {disponibles.length === 0 && (
                <div className="form-text">
                  Todos los campos del activo ya tienen su columna. Agregue una
                  característica propia si necesita pedir otro dato.
                </div>
              )}
            </div>
          ) : (
            <div className="mz-field mb-3">
              <label htmlFor="col-espec">Nombre de la característica</label>
              <input
                id="col-espec"
                className="form-control"
                required
                placeholder="Procesador, N.º de factura, Proveedor…"
                value={valores.nombreEspecificacion}
                onChange={(event) =>
                  setValores({
                    ...valores,
                    nombreEspecificacion: event.target.value,
                    etiqueta: valores.etiqueta || event.target.value,
                  })
                }
              />
              <div className="form-text">
                Se guarda con este nombre dentro de las especificaciones del
                activo, sin cambiar la base de datos.
              </div>
            </div>
          )}
        </>
      )}

      <div className="mz-field mb-3">
        <label htmlFor="col-etiqueta">Encabezado en la plantilla</label>
        <input
          id="col-etiqueta"
          className="form-control"
          required
          maxLength={120}
          value={valores.etiqueta}
          onChange={(event) =>
            setValores({ ...valores, etiqueta: event.target.value })
          }
        />
      </div>

      <div className="mz-field mb-3">
        <label htmlFor="col-ayuda">Ayuda</label>
        <textarea
          id="col-ayuda"
          className="form-control"
          rows={2}
          maxLength={255}
          value={valores.ayuda}
          onChange={(event) =>
            setValores({ ...valores, ayuda: event.target.value })
          }
        />
        <div className="form-text">
          Aparece como comentario al pasar el cursor sobre el encabezado en
          Excel.
        </div>
      </div>

      <div className="mz-field-grid">
        <div className="mz-field">
          <label htmlFor="col-orden">Orden</label>
          <input
            id="col-orden"
            type="number"
            min="0"
            className="form-control"
            value={valores.orden}
            onChange={(event) =>
              setValores({ ...valores, orden: event.target.value })
            }
          />
        </div>
        <div className="d-flex flex-column justify-content-end">
          <div className="form-check">
            <input
              id="col-activa"
              type="checkbox"
              className="form-check-input"
              checked={valores.activa}
              disabled={columna.es_estructural}
              onChange={(event) =>
                setValores({ ...valores, activa: event.target.checked })
              }
            />
            <label className="form-check-label" htmlFor="col-activa">
              Se pide en la plantilla
            </label>
          </div>
          <div className="form-check">
            <input
              id="col-obligatoria"
              type="checkbox"
              className="form-check-input"
              checked={valores.obligatoria}
              disabled={columna.es_estructural}
              onChange={(event) =>
                setValores({ ...valores, obligatoria: event.target.checked })
              }
            />
            <label className="form-check-label" htmlFor="col-obligatoria">
              Obligatoria
            </label>
          </div>
        </div>
      </div>

      {columna.es_estructural && (
        <div className="mz-alert mz-alert--info mt-3 mb-0" role="status">
          <Icon name="info-circle" />
          Esta columna es imprescindible para crear un activo, así que no se
          puede desactivar ni volver opcional. Sí puede cambiar su encabezado,
          su ayuda y su orden.
        </div>
      )}
    </ModalDialog>
  );
}
