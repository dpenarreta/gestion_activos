import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { categoriasActivoService } from "../../../api/activosService";
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
  { label: "Categorías" },
];
const FILTROS_INICIALES = {};
const VACIA = { nombre: "", descripcion: "", icono: "", activa: true };

/**
 * Catálogo de categorías de activo.
 *
 * La categoría es la naturaleza de lo que se inventaría —hardware, software,
 * mobiliario— y vive un nivel por encima del tipo: el tipo dice qué es una
 * cosa, la categoría de qué clase de bien se trata. Se administra porque cada
 * empresa inventaría cosas distintas, y un catálogo cerrado obligaría a tocar
 * el código la primera vez que alguien quiera registrar vehículos.
 *
 * Se edita en un diálogo, como los tipos: son tres campos y lo natural es
 * corregir un nombre sin perder de vista la lista.
 */
export function CategoriasList() {
  const puedeEditar = usePermission("activos.editar");
  const [enEdicion, setEnEdicion] = useState(null);
  const cargar = useCallback(
    (params) => categoriasActivoService.list(params),
    [],
  );
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el catálogo de categorías.",
  );

  return (
    <div className="activos-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Categorías de activo</h2>
        {puedeEditar && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEnEdicion(VACIA)}
          >
            Nueva categoría
          </button>
        )}
      </div>

      <p className="text-muted">
        De qué clase es cada cosa del inventario. Los tipos de dispositivo
        cuelgan de una categoría, y los equipos la heredan de su tipo.
      </p>

      {listado.error && (
        <div className="alert alert-danger">{listado.error}</div>
      )}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Descripción</th>
              <th className="text-end">Tipos</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((categoria) => (
              <tr key={categoria.id}>
                <td>
                  {categoria.icono && (
                    <i
                      className={`bi bi-${categoria.icono} me-2`}
                      aria-hidden="true"
                    />
                  )}
                  {categoria.nombre}
                </td>
                <td className="text-muted small">
                  {categoria.descripcion || "—"}
                </td>
                <td className="text-end">
                  {/* El conteo enlaza al inventario de esa categoría: es la
                      pregunta que trae aquí a cualquiera —cuánto hay de
                      esto— y verlo sin poder abrirlo obligaría a repetir el
                      filtro a mano. */}
                  {categoria.total_tipos > 0 ? (
                    <Link to={`/admin/activos?categoria=${categoria.id}`}>
                      {categoria.total_tipos}
                    </Link>
                  ) : (
                    0
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${
                      categoria.activa ? "text-bg-success" : "text-bg-secondary"
                    }`}
                  >
                    {categoria.activa ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td>
                  {puedeEditar && (
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => setEnEdicion(categoria)}
                    >
                      Editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted">
                  Sin categorías registradas
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
        etiqueta="categorías"
      />

      {enEdicion && (
        <CategoriaDialog
          categoria={enEdicion}
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

function CategoriaDialog({ categoria, onCerrar, onGuardado }) {
  const esEdicion = Boolean(categoria.id);
  const [valores, setValores] = useState({
    nombre: categoria.nombre || "",
    descripcion: categoria.descripcion || "",
    icono: categoria.icono || "",
    activa: categoria.activa ?? true,
  });
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (esEdicion) {
        await categoriasActivoService.update(categoria.id, valores);
      } else {
        await categoriasActivoService.create(valores);
      }
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la categoría."));
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo={esEdicion ? "Editar categoría" : "Nueva categoría"}
      textoConfirmar="Guardar"
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
    >
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="mb-3">
        <label className="form-label" htmlFor="categoria-nombre">
          Nombre
        </label>
        <input
          id="categoria-nombre"
          className="form-control"
          required
          maxLength={80}
          placeholder="Hardware, Software, Vehículos…"
          value={valores.nombre}
          onChange={(event) =>
            setValores({ ...valores, nombre: event.target.value })
          }
        />
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="categoria-descripcion">
          Qué entra aquí
        </label>
        <input
          id="categoria-descripcion"
          className="form-control"
          maxLength={200}
          placeholder="Licencias y suscripciones: ofimática, antivirus…"
          value={valores.descripcion}
          onChange={(event) =>
            setValores({ ...valores, descripcion: event.target.value })
          }
        />
        <div className="form-text">
          Se lee al elegir la categoría, para no tener que adivinar dónde va
          cada cosa.
        </div>
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor="categoria-icono">
          Icono (opcional)
        </label>
        <input
          id="categoria-icono"
          className="form-control font-monospace"
          maxLength={40}
          placeholder="pc-display, window-stack, building…"
          value={valores.icono}
          onChange={(event) =>
            setValores({ ...valores, icono: event.target.value })
          }
        />
        <div className="form-text">
          Nombre de un icono de Bootstrap Icons, sin el prefijo <code>bi-</code>
          . En blanco no pasa nada: la categoría se distingue por su nombre.
        </div>
      </div>

      {esEdicion && (
        <div className="form-check">
          <input
            id="categoria-activa"
            type="checkbox"
            className="form-check-input"
            checked={valores.activa}
            onChange={(event) =>
              setValores({ ...valores, activa: event.target.checked })
            }
          />
          <label className="form-check-label" htmlFor="categoria-activa">
            Activa
          </label>
          <div className="form-text">
            Una categoría inactiva deja de ofrecerse al clasificar tipos nuevos.
            Los que ya la tienen la conservan: no se borra nada.
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
