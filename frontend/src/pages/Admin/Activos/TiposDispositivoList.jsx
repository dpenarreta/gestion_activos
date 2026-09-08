import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { tiposDispositivoService } from "../../../api/activosService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Activos.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Activos", path: "/admin/activos" },
  { label: "Tipos de dispositivo" },
];
const FILTROS_INICIALES = { q: "" };
const VACIO = { nombre: "", codigo: "", descripcion: "", activo: true };

/**
 * Catálogo de tipos de dispositivo.
 *
 * Se edita en un diálogo y no en una página aparte porque son tres campos y
 * el flujo natural es corregir un nombre sin perder de vista la lista. El
 * `codigo` es el dato delicado: entra en el código de barras de cada activo
 * de ese tipo, así que cambiarlo no renumera los ya emitidos.
 */
export function TiposDispositivoList() {
  const puedeEditar = usePermission("activos.editar");
  const [busqueda, setBusqueda] = useState("");
  const [enEdicion, setEnEdicion] = useState(null);
  const cargar = useCallback((params) => tiposDispositivoService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el catálogo de tipos."
  );

  return (
    <div className="activos-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Tipos de dispositivo</h2>
        {puedeEditar && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEnEdicion(VACIO)}>
            Nuevo tipo
          </button>
        )}
      </div>

      <form
        className="d-flex gap-2 mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          listado.actualizarFiltros({ q: busqueda });
        }}
      >
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Buscar por nombre o código"
          aria-label="Buscar tipos de dispositivo"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
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
              <th className="text-end">Activos</th>
              <th>Política</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((tipo) => (
              <tr key={tipo.id}>
                <td>
                  <code className="codigo-barras">{tipo.codigo}</code>
                </td>
                <td>{tipo.nombre}</td>
                <td className="text-muted small">{tipo.descripcion || "—"}</td>
                <td className="text-end">
                  {tipo.total_activos > 0 ? (
                    <Link to={`/admin/activos?tipo=${tipo.id}`}>{tipo.total_activos}</Link>
                  ) : (
                    0
                  )}
                </td>
                <td>
                  {tipo.tiene_politica ? (
                    <span className="badge text-bg-info">Propia</span>
                  ) : (
                    <span className="text-muted small">Usa la global</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${tipo.activo ? "text-bg-success" : "text-bg-secondary"}`}>
                    {tipo.activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td>
                  {puedeEditar && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setEnEdicion(tipo)}
                    >
                      Editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted">
                  Sin tipos de dispositivo registrados
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
        etiqueta="tipos"
      />

      {enEdicion && (
        <TipoDialog
          tipo={enEdicion}
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

function TipoDialog({ tipo, onCerrar, onGuardado }) {
  const esEdicion = Boolean(tipo.id);
  const [valores, setValores] = useState({
    nombre: tipo.nombre || "",
    codigo: tipo.codigo || "",
    descripcion: tipo.descripcion || "",
    activo: tipo.activo ?? true,
  });
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (esEdicion) {
        await tiposDispositivoService.update(tipo.id, valores);
      } else {
        await tiposDispositivoService.create(valores);
      }
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el tipo de dispositivo."));
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo={esEdicion ? "Editar tipo de dispositivo" : "Nuevo tipo de dispositivo"}
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="mb-3">
        <label className="form-label" htmlFor="tipo-nombre">
          Nombre
        </label>
        <input
          id="tipo-nombre"
          className="form-control"
          required
          maxLength={120}
          placeholder="Laptop, Servidor, Impresora…"
          value={valores.nombre}
          onChange={(event) => setValores({ ...valores, nombre: event.target.value })}
        />
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="tipo-codigo">
          Código
        </label>
        <input
          id="tipo-codigo"
          className="form-control text-uppercase font-monospace"
          required
          maxLength={10}
          pattern="[A-Za-z0-9]+"
          placeholder="LAP"
          value={valores.codigo}
          onChange={(event) => setValores({ ...valores, codigo: event.target.value })}
        />
        <div className="form-text">
          Solo letras y dígitos: forma parte del código de barras de cada activo de este tipo
          (por ejemplo <code>GA-LAP-000001</code>).
          {esEdicion && " Cambiarlo no renumera los activos ya registrados."}
        </div>
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="tipo-descripcion">
          Descripción
        </label>
        <textarea
          id="tipo-descripcion"
          className="form-control"
          rows={2}
          value={valores.descripcion}
          onChange={(event) => setValores({ ...valores, descripcion: event.target.value })}
        />
      </div>

      <div className="form-check">
        <input
          id="tipo-activo"
          type="checkbox"
          className="form-check-input"
          checked={valores.activo}
          onChange={(event) => setValores({ ...valores, activo: event.target.checked })}
        />
        <label className="form-check-label" htmlFor="tipo-activo">
          Disponible para registrar activos nuevos
        </label>
      </div>
    </ModalDialog>
  );
}
