import { useCallback, useState } from "react";

import { componentesService } from "../../../api/mantenimientosService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Mantenimientos.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Mantenimientos", path: "/admin/mantenimientos" },
  { label: "Componentes" },
];
const FILTROS_INICIALES = { q: "", es_critico: "" };
const VACIO = { nombre: "", codigo: "", descripcion: "", es_critico: false, activo: true };

/**
 * Catálogo de repuestos.
 *
 * `es_critico` es el campo que conecta este catálogo con la política de
 * renovación (RF-06): solo el reemplazo de las piezas marcadas aquí cuenta
 * contra el umbral de "piezas críticas sustituidas".
 */
export function ComponentesList() {
  const puedeEditar = usePermission("mantenimientos.componentes");
  const [busqueda, setBusqueda] = useState("");
  const [enEdicion, setEnEdicion] = useState(null);
  const cargar = useCallback((params) => componentesService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el catálogo de componentes."
  );

  return (
    <div className="mantenimientos-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Catálogo de componentes</h2>
        {puedeEditar && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEnEdicion(VACIO)}>
            Nuevo componente
          </button>
        )}
      </div>

      <p className="text-muted">
        Las piezas marcadas como <strong>críticas</strong> son las que cuentan contra el umbral de
        sustituciones de la política de renovación.
      </p>

      <form
        className="d-flex gap-2 mb-3 flex-wrap"
        onSubmit={(event) => {
          event.preventDefault();
          listado.actualizarFiltros({ q: busqueda });
        }}
      >
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Buscar por nombre o código"
          aria-label="Buscar componentes"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por criticidad"
          value={listado.filtros.es_critico}
          onChange={(event) => listado.actualizarFiltros({ es_critico: event.target.value })}
        >
          <option value="">Todas las piezas</option>
          <option value="true">Solo críticas</option>
          <option value="false">Solo no críticas</option>
        </select>
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
      </form>

      {listado.error && <div className="alert alert-danger">{listado.error}</div>}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Descripción</th>
              <th>Criticidad</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((componente) => (
              <tr key={componente.id}>
                <td>
                  <code className="codigo-barras">{componente.codigo}</code>
                </td>
                <td>{componente.nombre}</td>
                <td className="text-muted small">{componente.descripcion || "—"}</td>
                <td>
                  {componente.es_critico ? (
                    <span className="badge text-bg-danger">Crítica</span>
                  ) : (
                    <span className="text-muted small">Común</span>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${componente.activo ? "text-bg-success" : "text-bg-secondary"}`}
                  >
                    {componente.activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td>
                  {puedeEditar && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setEnEdicion(componente)}
                    >
                      Editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted">
                  Sin componentes registrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Paginacion
        total={listado.total}
        pagina={listado.pagina}
        hasNext={listado.hasNext}
        hasPrevious={listado.hasPrevious}
        onCambiarPagina={listado.setPagina}
        etiqueta="componentes"
      />

      {enEdicion && (
        <ComponenteDialog
          componente={enEdicion}
          onCerrar={() => setEnEdicion(null)}
          onGuardado={() => {
            setEnEdicion(null);
            listado.refresh();
          }}
        />
      )}
    </div>
  );
}

function ComponenteDialog({ componente, onCerrar, onGuardado }) {
  const esEdicion = Boolean(componente.id);
  const [valores, setValores] = useState({
    nombre: componente.nombre || "",
    codigo: componente.codigo || "",
    descripcion: componente.descripcion || "",
    es_critico: componente.es_critico ?? false,
    activo: componente.activo ?? true,
  });
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const cambiaCriticidad = esEdicion && valores.es_critico !== componente.es_critico;

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (esEdicion) {
        await componentesService.update(componente.id, valores);
      } else {
        await componentesService.create(valores);
      }
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el componente."));
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo={esEdicion ? "Editar componente" : "Nuevo componente"}
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-3">
        <div className="col-8">
          <label className="form-label" htmlFor="comp-nombre">
            Nombre
          </label>
          <input
            id="comp-nombre"
            className="form-control"
            required
            maxLength={150}
            placeholder="Disco duro SSD, tarjeta madre…"
            value={valores.nombre}
            onChange={(event) => setValores({ ...valores, nombre: event.target.value })}
          />
        </div>
        <div className="col-4">
          <label className="form-label" htmlFor="comp-codigo">
            Código
          </label>
          <input
            id="comp-codigo"
            className="form-control text-uppercase font-monospace"
            required
            maxLength={30}
            value={valores.codigo}
            onChange={(event) => setValores({ ...valores, codigo: event.target.value })}
          />
        </div>
        <div className="col-12">
          <label className="form-label" htmlFor="comp-descripcion">
            Descripción
          </label>
          <textarea
            id="comp-descripcion"
            className="form-control"
            rows={2}
            value={valores.descripcion}
            onChange={(event) => setValores({ ...valores, descripcion: event.target.value })}
          />
        </div>
        <div className="col-12">
          <div className="form-check">
            <input
              id="comp-critico"
              type="checkbox"
              className="form-check-input"
              checked={valores.es_critico}
              onChange={(event) => setValores({ ...valores, es_critico: event.target.checked })}
            />
            <label className="form-check-label" htmlFor="comp-critico">
              Pieza crítica
            </label>
          </div>
          <div className="form-text">
            Su reemplazo contará contra el umbral de sustituciones de la política de renovación
            (tarjeta madre, disco duro, fuente de poder…).
          </div>
        </div>
        <div className="col-12">
          <div className="form-check">
            <input
              id="comp-activo"
              type="checkbox"
              className="form-check-input"
              checked={valores.activo}
              onChange={(event) => setValores({ ...valores, activo: event.target.checked })}
            />
            <label className="form-check-label" htmlFor="comp-activo">
              Disponible para registrar en intervenciones
            </label>
          </div>
        </div>
      </div>

      {cambiaCriticidad && (
        <div className="alert alert-info mt-3 mb-0">
          El cambio rige de aquí en adelante. Las intervenciones ya registradas conservan la
          criticidad que la pieza tenía cuando se consumió, así que los contadores actuales de los
          equipos no se alteran.
        </div>
      )}
    </ModalDialog>
  );
}
