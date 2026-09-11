import { useCallback, useEffect, useState } from "react";

import { tiposDispositivoService } from "../../../api/activosService";
import { depreciacionService } from "../../../api/politicasService";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import { formatearMeses } from "../../../utils/formato";
import "./Politicas.css";

const VACIA = {
  nombre: "",
  tipo_dispositivo: "",
  meses_vida_contable: 36,
  porcentaje_residual: "0",
  activa: true,
};

/**
 * En cuánto tiempo pierde su valor cada tipo de equipo (§22.3).
 *
 * Es depreciación **de gestión**: sirve para saber qué vale hoy el parque y
 * cuánto se pierde al dar de baja un equipo antes de tiempo, que es lo que
 * respalda una solicitud de compra. La contabilidad formal la lleva el ERP, y
 * por eso hay un solo método —línea recta— y no una lista donde elegir.
 *
 * La pantalla insiste en una distinción que se confunde sola: la vida contable
 * no es la vida útil de la política de renovación. Un equipo se deprecia en
 * tres años y se reemplaza a los cuatro o cinco; confundirlas dejaría que la
 * contabilidad decidiera cuándo se compra.
 */
export function DepreciacionPanel() {
  const puedeEditar = usePermission("politicas.editar");
  const [tipos, setTipos] = useState([]);
  const [enEdicion, setEnEdicion] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const [errorAccion, setErrorAccion] = useState(null);

  const cargar = useCallback((params) => depreciacionService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    {},
    "No se pudo cargar el listado de políticas de depreciación.",
  );

  useEffect(() => {
    tiposDispositivoService
      .list({ page_size: 100 })
      .then((datos) => setTipos(datos.results ?? datos))
      .catch(() => setTipos([]));
  }, []);

  async function confirmarEliminacion() {
    try {
      await depreciacionService.remove(aEliminar.id);
      setAEliminar(null);
      listado.refresh();
    } catch (err) {
      setErrorAccion(mensajeDeError(err, "No se pudo eliminar la política."));
      setAEliminar(null);
    }
  }

  const hayGlobal = listado.resultados.some((politica) => politica.es_global);

  return (
    <div className="politicas-panel">
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h3 className="h5 mb-0">Cuánto vale en libros cada tipo de equipo</h3>
        {puedeEditar && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEnEdicion(VACIA)}
          >
            Nueva política de depreciación
          </button>
        )}
      </div>

      <p className="text-muted">
        El costo se reparte en partes iguales entre los meses de vida contable.
        No es la vida útil de la política de renovación: un equipo se deprecia
        en tres años y se reemplaza a los cuatro o cinco, y seguir usando un
        equipo ya depreciado es lo normal.
      </p>

      {listado.error && (
        <div className="alert alert-danger">{listado.error}</div>
      )}
      {errorAccion && <div className="alert alert-danger">{errorAccion}</div>}
      {!listado.isLoading && !hayGlobal && (
        <div className="alert alert-warning">
          No hay una política global. Los tipos de dispositivo sin política
          propia no muestran valor en libros, y el reporte de valor del parque
          saldrá con esas columnas vacías.
        </div>
      )}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Política</th>
              <th>Alcance</th>
              <th className="text-end">Vida contable</th>
              <th className="text-end">Valor residual</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((politica) => (
              <tr key={politica.id}>
                <td>{politica.nombre}</td>
                <td>
                  {politica.es_global ? (
                    <span className="badge text-bg-primary">Global</span>
                  ) : (
                    politica.tipo_dispositivo_nombre
                  )}
                </td>
                <td className="text-end">
                  {formatearMeses(politica.meses_vida_contable)}
                </td>
                <td className="text-end">
                  {Number(politica.porcentaje_residual) > 0 ? (
                    `${politica.porcentaje_residual} %`
                  ) : (
                    // Cero es el caso normal en equipo de cómputo: se
                    // deprecia por completo.
                    <span className="text-muted small">Sin residual</span>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${politica.activa ? "text-bg-success" : "text-bg-secondary"}`}
                  >
                    {politica.activa ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td>
                  {puedeEditar && (
                    <div className="d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => setEnEdicion(politica)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => setAEliminar(politica)}
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted">
                  Sin políticas de depreciación. Ningún equipo mostrará valor en
                  libros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {enEdicion && (
        <DepreciacionDialog
          politica={enEdicion}
          tipos={tipos}
          hayGlobal={hayGlobal}
          onCerrar={() => setEnEdicion(null)}
          onGuardado={() => {
            setEnEdicion(null);
            listado.refresh();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(aEliminar)}
        title="Eliminar política de depreciación"
        message={
          aEliminar
            ? aEliminar.es_global
              ? `Se eliminará la política global "${aEliminar.nombre}". Los tipos sin política propia dejarán de mostrar valor en libros.`
              : `Se eliminará "${aEliminar.nombre}". Los activos de ${aEliminar.tipo_dispositivo_nombre} pasarán a depreciarse con la política global.`
            : ""
        }
        onConfirm={confirmarEliminacion}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}

function DepreciacionDialog({
  politica,
  tipos,
  hayGlobal,
  onCerrar,
  onGuardado,
}) {
  const esEdicion = Boolean(politica.id);
  const [valores, setValores] = useState({
    nombre: politica.nombre || "",
    tipo_dispositivo: politica.tipo_dispositivo || "",
    meses_vida_contable: politica.meses_vida_contable ?? 36,
    porcentaje_residual: politica.porcentaje_residual ?? "0",
    activa: politica.activa ?? true,
  });
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Solo puede existir una política global: ofrecer la opción cuando ya hay
  // otra produciría un error al guardar.
  const puedeSerGlobal = !hayGlobal || politica.es_global;
  const vidaInvalida = Number(valores.meses_vida_contable) < 1;
  const residualInvalido =
    Number(valores.porcentaje_residual) < 0 ||
    Number(valores.porcentaje_residual) >= 100;

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        nombre: valores.nombre,
        tipo_dispositivo: valores.tipo_dispositivo || null,
        meses_vida_contable: Number(valores.meses_vida_contable),
        porcentaje_residual: valores.porcentaje_residual || "0",
        activa: valores.activa,
      };
      if (esEdicion) {
        await depreciacionService.update(politica.id, payload);
      } else {
        await depreciacionService.create(payload);
      }
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la política."));
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo={
        esEdicion
          ? "Editar política de depreciación"
          : "Nueva política de depreciación"
      }
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      puedeConfirmar={!vidaInvalida && !residualInvalido}
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="mb-3">
        <label className="form-label" htmlFor="dep-nombre">
          Nombre
        </label>
        <input
          id="dep-nombre"
          className="form-control"
          required
          maxLength={120}
          placeholder="Equipos de cómputo"
          value={valores.nombre}
          onChange={(event) =>
            setValores({ ...valores, nombre: event.target.value })
          }
        />
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="dep-tipo">
          Se aplica a
        </label>
        <select
          id="dep-tipo"
          className="form-select"
          value={valores.tipo_dispositivo}
          onChange={(event) =>
            setValores({ ...valores, tipo_dispositivo: event.target.value })
          }
        >
          <option value="" disabled={!puedeSerGlobal}>
            Todos los tipos (política global)
            {!puedeSerGlobal && " — ya existe una"}
          </option>
          {tipos.map((tipo) => (
            <option key={tipo.id} value={tipo.id}>
              {tipo.nombre}
            </option>
          ))}
        </select>
        <div className="form-text">
          La política de un tipo específico tiene prioridad sobre la global.
        </div>
      </div>

      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label" htmlFor="dep-vida">
            Vida contable (meses)
          </label>
          <input
            id="dep-vida"
            type="number"
            min="1"
            className="form-control"
            value={valores.meses_vida_contable}
            onChange={(event) =>
              setValores({
                ...valores,
                meses_vida_contable: event.target.value,
              })
            }
          />
          <div className="form-text">
            {/* 36 meses es lo que fija el reglamento ecuatoriano para equipo
                de cómputo; un rack o un UPS viven bastante más. */}
            36 meses para equipo de cómputo. No es la vida útil de la política
            de renovación.
          </div>
        </div>
        <div className="col-md-6">
          <label className="form-label" htmlFor="dep-residual">
            Valor residual (%)
          </label>
          <input
            id="dep-residual"
            type="number"
            min="0"
            max="99.99"
            step="0.01"
            className="form-control"
            value={valores.porcentaje_residual}
            onChange={(event) =>
              setValores({
                ...valores,
                porcentaje_residual: event.target.value,
              })
            }
          />
          <div className="form-text">
            Porcentaje del costo que el equipo conserva al terminar. Cero
            significa que se deprecia por completo.
          </div>
        </div>
      </div>

      {vidaInvalida && (
        <div className="alert alert-warning mt-3 mb-0 small">
          La vida contable debe ser de al menos un mes. Para dejar de depreciar
          un tipo, desactive la política.
        </div>
      )}
      {residualInvalido && (
        <div className="alert alert-warning mt-3 mb-0 small">
          El valor residual va entre 0 y 99,99: un equipo que conserva todo su
          valor no se deprecia nunca.
        </div>
      )}

      <div className="form-check mt-3">
        <input
          id="dep-activa"
          type="checkbox"
          className="form-check-input"
          checked={valores.activa}
          onChange={(event) =>
            setValores({ ...valores, activa: event.target.checked })
          }
        />
        <label className="form-check-label" htmlFor="dep-activa">
          Política activa
        </label>
        <div className="form-text">
          Desactivar la de un tipo significa «este tipo no se deprecia»; no hace
          que caiga en la global.
        </div>
      </div>
    </ModalDialog>
  );
}
