import { useCallback, useEffect, useState } from "react";

import { tiposDispositivoService } from "../../../api/activosService";
import { politicasService } from "../../../api/politicasService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Politicas.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Políticas de renovación" }];
const VACIO = {
  nombre: "",
  tipo_dispositivo: "",
  max_mantenimientos: "",
  ventana_mantenimientos_meses: "",
  max_componentes_criticos: "",
  vida_util_meses: "",
  vida_util_critica_meses: "",
  activa: true,
};

/**
 * Valores que enuncia el §11 del documento funcional. Se ofrecen como atajo
 * al crear una política, no como valores por defecto: rellenar solo el que
 * falta es distinto de imponerle a la empresa unos umbrales que no eligió.
 */
const UMBRALES_SUGERIDOS = {
  vida_util_meses: "48",
  vida_util_critica_meses: "60",
  max_mantenimientos: "3",
  ventana_mantenimientos_meses: "12",
};

/**
 * Parametrización de los criterios de sustitución (RF-06, §11).
 *
 * Los umbrales están escalonados en dos niveles: la vida útil sugiere
 * «evaluar» el reemplazo y la vida útil crítica lo «recomienda». Con un solo
 * nivel había que elegir entre avisar tarde o llenar la pantalla de alertas
 * que nadie puede atender todas a la vez.
 *
 * Un umbral vacío no significa cero: significa "no evaluar este criterio".
 * Es la distinción más fácil de malinterpretar de todo el módulo —dejar la
 * vida útil en blanco pensando que desactiva la alerta, cuando ponerla en
 * cero la dispararía para todos los equipos—, así que se explica en el
 * formulario y no solo en la documentación.
 */
export function PoliticasList() {
  const puedeEditar = usePermission("politicas.editar");
  const [tipos, setTipos] = useState([]);
  const [enEdicion, setEnEdicion] = useState(null);
  const [aEliminar, setAEliminar] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [errorAccion, setErrorAccion] = useState(null);

  const cargar = useCallback((params) => politicasService.list(params), []);
  const listado = useListadoPaginado(cargar, {}, "No se pudo cargar el listado de políticas.");

  useEffect(() => {
    tiposDispositivoService
      .list({ page_size: 100 })
      .then((datos) => setTipos(datos.results ?? datos))
      .catch(() => setTipos([]));
  }, []);

  async function handleReevaluar() {
    setErrorAccion(null);
    try {
      const resultado = await politicasService.reevaluar();
      const { recomendado = 0, evaluar = 0 } = resultado.por_nivel ?? {};
      setAviso(
        `${resultado.activos_evaluados} activo(s) evaluados; ${resultado.con_sugerencia} con ` +
          `sugerencia (${recomendado} con reemplazo recomendado, ${evaluar} a evaluar).`
      );
      listado.refresh();
    } catch (err) {
      setErrorAccion(mensajeDeError(err, "No se pudo reevaluar el inventario."));
    }
  }

  async function confirmarEliminacion() {
    try {
      await politicasService.remove(aEliminar.id);
      setAEliminar(null);
      listado.refresh();
    } catch (err) {
      setErrorAccion(mensajeDeError(err, "No se pudo eliminar la política."));
      setAEliminar(null);
    }
  }

  const hayGlobal = listado.resultados.some((politica) => politica.es_global);

  return (
    <div className="politicas-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2>Políticas de renovación</h2>
        <div className="d-flex gap-2">
          {puedeEditar && (
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleReevaluar}>
              Reevaluar inventario
            </button>
          )}
          {puedeEditar && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEnEdicion(VACIO)}>
              Nueva política
            </button>
          )}
        </div>
      </div>

      <p className="text-muted">
        Definen cuándo el sistema sugiere reemplazar un equipo. La política de un tipo de
        dispositivo tiene prioridad sobre la global; los tipos sin política propia se rigen por
        ella.
      </p>

      {aviso && (
        <div className="alert alert-info alert-dismissible">
          {aviso}
          <button type="button" className="btn-close" aria-label="Cerrar" onClick={() => setAviso(null)} />
        </div>
      )}
      {listado.error && <div className="alert alert-danger">{listado.error}</div>}
      {errorAccion && <div className="alert alert-danger">{errorAccion}</div>}
      {!listado.isLoading && !hayGlobal && listado.resultados.length > 0 && (
        <div className="alert alert-warning">
          No hay una política global. Los tipos de dispositivo sin política propia no se evalúan y
          nunca mostrarán una sugerencia de renovación.
        </div>
      )}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Política</th>
              <th>Alcance</th>
              <th className="text-end">Máx. mantenimientos</th>
              <th className="text-end">Máx. piezas críticas</th>
              <th className="text-end">Evaluar a los</th>
              <th className="text-end">Recomendar a los</th>
              <th className="ps-4">Estado</th>
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
                <Umbral
                  valor={politica.max_mantenimientos}
                  nota={
                    politica.ventana_mantenimientos_meses
                      ? `en ${politica.ventana_mantenimientos_meses} meses`
                      : "histórico"
                  }
                />
                <Umbral valor={politica.max_componentes_criticos} />
                <Umbral valor={politica.vida_util_meses} sufijo=" meses" />
                <Umbral valor={politica.vida_util_critica_meses} sufijo=" meses" />
                <td className="ps-4">
                  <span className={`badge ${politica.activa ? "text-bg-success" : "text-bg-secondary"}`}>
                    {politica.activa ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td>
                  {puedeEditar && (
                    <div className="d-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
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
                <td colSpan={8} className="text-center text-muted">
                  Sin políticas configuradas. Ningún equipo mostrará sugerencias de renovación.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {enEdicion && (
        <PoliticaDialog
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
        title="Eliminar política"
        message={
          aEliminar
            ? aEliminar.es_global
              ? `Se eliminará la política global "${aEliminar.nombre}". Los tipos sin política propia dejarán de evaluarse y sus alertas se apagarán.`
              : `Se eliminará "${aEliminar.nombre}". Los activos de ${aEliminar.tipo_dispositivo_nombre} pasarán a regirse por la política global y se reevaluarán.`
            : ""
        }
        onConfirm={confirmarEliminacion}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}

/** Un umbral vacío se muestra como "no evalúa", no como cero. */
function Umbral({ valor, sufijo = "", nota }) {
  return (
    <td className="text-end">
      {valor === null || valor === undefined ? (
        <span className="text-muted small">no evalúa</span>
      ) : (
        <>
          {valor}
          {sufijo}
          {/* El periodo acompaña al número: «3 mantenimientos» significa algo
              muy distinto en 12 meses que en toda la vida del equipo. */}
          {nota && <small className="d-block text-muted">{nota}</small>}
        </>
      )}
    </td>
  );
}

function PoliticaDialog({ politica, tipos, hayGlobal, onCerrar, onGuardado }) {
  const esEdicion = Boolean(politica.id);
  const [valores, setValores] = useState({
    nombre: politica.nombre || "",
    tipo_dispositivo: politica.tipo_dispositivo || "",
    max_mantenimientos: politica.max_mantenimientos ?? "",
    ventana_mantenimientos_meses: politica.ventana_mantenimientos_meses ?? "",
    max_componentes_criticos: politica.max_componentes_criticos ?? "",
    vida_util_meses: politica.vida_util_meses ?? "",
    vida_util_critica_meses: politica.vida_util_critica_meses ?? "",
    activa: politica.activa ?? true,
  });
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const sinUmbrales =
    valores.max_mantenimientos === "" &&
    valores.max_componentes_criticos === "" &&
    valores.vida_util_meses === "" &&
    valores.vida_util_critica_meses === "";

  // Se avisa antes de guardar, porque el mensaje del servidor llega cuando el
  // usuario ya dio por terminado el formulario.
  const segundoNivelInvertido =
    valores.vida_util_meses !== "" &&
    valores.vida_util_critica_meses !== "" &&
    Number(valores.vida_util_critica_meses) <= Number(valores.vida_util_meses);
  const ventanaSinMaximo =
    valores.ventana_mantenimientos_meses !== "" && valores.max_mantenimientos === "";

  // Solo puede existir una política global; ofrecer la opción cuando ya hay
  // otra produciría un error de restricción al guardar.
  const puedeSerGlobal = !hayGlobal || politica.es_global;

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        nombre: valores.nombre,
        tipo_dispositivo: valores.tipo_dispositivo || null,
        // Cadena vacía significa "no evaluar este criterio": se envía null,
        // que es lo que el backend interpreta como umbral desactivado.
        max_mantenimientos: valores.max_mantenimientos === "" ? null : Number(valores.max_mantenimientos),
        ventana_mantenimientos_meses:
          valores.ventana_mantenimientos_meses === ""
            ? null
            : Number(valores.ventana_mantenimientos_meses),
        max_componentes_criticos:
          valores.max_componentes_criticos === "" ? null : Number(valores.max_componentes_criticos),
        vida_util_meses: valores.vida_util_meses === "" ? null : Number(valores.vida_util_meses),
        vida_util_critica_meses:
          valores.vida_util_critica_meses === "" ? null : Number(valores.vida_util_critica_meses),
        activa: valores.activa,
      };
      if (esEdicion) {
        await politicasService.update(politica.id, payload);
      } else {
        await politicasService.create(payload);
      }
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la política."));
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo={esEdicion ? "Editar política" : "Nueva política de renovación"}
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
      puedeConfirmar={!sinUmbrales && !segundoNivelInvertido && !ventanaSinMaximo}
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="mb-3">
        <label className="form-label" htmlFor="pol-nombre">
          Nombre
        </label>
        <input
          id="pol-nombre"
          className="form-control"
          required
          maxLength={120}
          placeholder="Laptops corporativas"
          value={valores.nombre}
          onChange={(event) => setValores({ ...valores, nombre: event.target.value })}
        />
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="pol-tipo">
          Se aplica a
        </label>
        <select
          id="pol-tipo"
          className="form-select"
          value={valores.tipo_dispositivo}
          onChange={(event) => setValores({ ...valores, tipo_dispositivo: event.target.value })}
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

      <fieldset className="mb-3">
        <legend className="form-label">Umbrales</legend>
        <div className="alert alert-info small">
          Dejar un umbral <strong>vacío</strong> desactiva ese criterio. Ponerlo en{" "}
          <strong>cero</strong> es distinto: haría que la alerta se dispare siempre.
        </div>

        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label" htmlFor="pol-vida">
              Evaluar reemplazo a los (meses)
            </label>
            <input
              id="pol-vida"
              type="number"
              min="0"
              className="form-control"
              placeholder="Sin límite"
              value={valores.vida_util_meses}
              onChange={(event) => setValores({ ...valores, vida_util_meses: event.target.value })}
            />
            <div className="form-text">Primer aviso: conviene empezar a mirarlo.</div>
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="pol-vida-critica">
              Recomendar reemplazo a los (meses)
            </label>
            <input
              id="pol-vida-critica"
              type="number"
              min="0"
              className="form-control"
              placeholder="Sin segundo nivel"
              value={valores.vida_util_critica_meses}
              onChange={(event) =>
                setValores({ ...valores, vida_util_critica_meses: event.target.value })
              }
            />
            <div className="form-text">Segundo aviso: ya toca presupuestarlo.</div>
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="pol-mant">
              Máx. mantenimientos
            </label>
            <input
              id="pol-mant"
              type="number"
              min="0"
              className="form-control"
              placeholder="Sin límite"
              value={valores.max_mantenimientos}
              onChange={(event) =>
                setValores({ ...valores, max_mantenimientos: event.target.value })
              }
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="pol-ventana">
              Contados en los últimos (meses)
            </label>
            <input
              id="pol-ventana"
              type="number"
              min="1"
              className="form-control"
              placeholder="Todo el historial"
              value={valores.ventana_mantenimientos_meses}
              onChange={(event) =>
                setValores({ ...valores, ventana_mantenimientos_meses: event.target.value })
              }
            />
            <div className="form-text">
              {/* Sin ventana el contador solo sube: un equipo que falló mucho
                  hace seis años queda marcado para siempre. */}
              Vacío = todo el historial del equipo.
            </div>
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="pol-criticas">
              Máx. piezas críticas
            </label>
            <input
              id="pol-criticas"
              type="number"
              min="0"
              className="form-control"
              placeholder="Sin límite"
              value={valores.max_componentes_criticos}
              onChange={(event) =>
                setValores({ ...valores, max_componentes_criticos: event.target.value })
              }
            />
          </div>
        </div>

        {!esEdicion && (
          <button
            type="button"
            className="btn btn-link btn-sm px-0 mt-2"
            onClick={() => setValores({ ...valores, ...UMBRALES_SUGERIDOS })}
          >
            Usar los umbrales del documento funcional (48 / 60 meses, 3 reparaciones en 12 meses)
          </button>
        )}

        {sinUmbrales && (
          <div className="alert alert-warning mt-3 mb-0 small">
            Defina al menos un umbral: una política sin ninguno no evaluaría nada.
          </div>
        )}
        {segundoNivelInvertido && (
          <div className="alert alert-warning mt-3 mb-0 small">
            El segundo nivel debe ser posterior al primero. Al revés, «recomendar» absorbería a
            «evaluar» y el primer aviso no llegaría nunca.
          </div>
        )}
        {ventanaSinMaximo && (
          <div className="alert alert-warning mt-3 mb-0 small">
            La ventana solo tiene sentido junto a un máximo de mantenimientos.
          </div>
        )}
      </fieldset>

      <div className="form-check">
        <input
          id="pol-activa"
          type="checkbox"
          className="form-check-input"
          checked={valores.activa}
          onChange={(event) => setValores({ ...valores, activa: event.target.checked })}
        />
        <label className="form-check-label" htmlFor="pol-activa">
          Política activa
        </label>
        <div className="form-text">
          Desactivar una política de tipo significa «este tipo no se evalúa»; no hace que caiga en
          la global.
        </div>
      </div>
    </ModalDialog>
  );
}
