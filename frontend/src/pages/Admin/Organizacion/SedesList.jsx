import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { sedesService } from "../../../api/organizacionService";
import { FilaDeEstado } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

const FILTROS_INICIALES = { q: "", activa: "" };

/**
 * Catálogo de edificios, locales o ciudades: dónde está cada equipo.
 *
 * Es un catálogo y no un texto dentro de cada activo porque «Sede Quito
 * Norte», «sede quito norte» y «Quito Norte» son el mismo edificio para una
 * persona y tres para una consulta: con texto libre, filtrar el inventario por
 * sede devuelve un tercio de los equipos que están ahí y nadie nota lo que
 * falta. Renombrar una sede —una mudanza, un cambio de razón social— es aquí
 * una edición, no una búsqueda y reemplazo por todo el parque.
 */
export function SedesList() {
  const puedeEditar = usePermission("organizacion.editar");
  const [busqueda, setBusqueda] = useState("");
  const cargar = useCallback((params) => sedesService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el listado de sedes.",
  );

  const hayFiltros = Object.values(listado.filtros).some(Boolean);

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  // También vacía la caja de búsqueda: si no, el texto seguiría ahí y el
  // próximo «Buscar» volvería a filtrar por él.
  function limpiarFiltros() {
    setBusqueda("");
    listado.actualizarFiltros(FILTROS_INICIALES);
  }

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Sedes</h2>
          <p className="mz-desc">
            Los edificios y locales donde puede estar un equipo, escritos una
            sola vez para que el inventario se filtre sin perder ninguno.
          </p>
        </div>
        {puedeEditar && (
          <div className="mz-view-actions">
            <Link
              to="/admin/organizacion/sedes/new"
              className="btn btn-primary btn-sm"
            >
              <Icon name="plus-lg" /> Nueva sede
            </Link>
          </div>
        )}
      </div>

      <form className="mz-filter-bar" onSubmit={handleBuscar} role="search">
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar sedes</span>
          <input
            type="search"
            placeholder="Buscar por nombre o ciudad"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
        </label>
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por estado"
          value={listado.filtros.activa}
          onChange={(event) =>
            listado.actualizarFiltros({ activa: event.target.value })
          }
        >
          <option value="">Todas</option>
          <option value="true">Abiertas</option>
          <option value="false">Cerradas</option>
        </select>
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
      </form>

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Ciudad</th>
              <th>Dirección</th>
              <th className="num">Activos</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {/* Cargando, error con reintento y un vacío que distingue «no
                hay registros» de «el filtro no encuentra nada» (auditoría
                UX/UI, fase 2, 28/10/2026). */}
            <FilaDeEstado
              columnas={6}
              cargando={listado.isLoading && listado.resultados.length === 0}
              error={listado.error}
              onReintentar={listado.refresh}
              vacio={!listado.isLoading && listado.resultados.length === 0}
              textoVacio="Todavía no hay sedes registradas."
              hayFiltros={hayFiltros}
              onLimpiarFiltros={limpiarFiltros}
            />
            {!listado.error &&
              listado.resultados.map((sede) => (
                <tr key={sede.id}>
                  <td className="mz-strong">{sede.nombre}</td>
                  <td>{sede.ciudad || "—"}</td>
                  <td className="mz-faint">{sede.direccion || "—"}</td>
                  <td className="num">{sede.total_activos}</td>
                  <td>
                    <span
                      className={`mz-pill ${sede.activa ? "mz-pill--ok" : "mz-pill--neutral"}`}
                    >
                      {sede.activa ? "Abierta" : "Cerrada"}
                    </span>
                  </td>
                  <td className="acciones">
                    <Link
                      to={`/admin/organizacion/sedes/${sede.id}`}
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`${puedeEditar ? "Editar" : "Ver"} ${sede.nombre}`}
                    >
                      {puedeEditar ? "Editar" : "Ver"}
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Paginacion
        total={listado.total}
        pagina={listado.pagina}
        hasNext={listado.hasNext}
        hasPrevious={listado.hasPrevious}
        onCambiarPagina={listado.setPagina}
        etiqueta="sedes"
      />
    </div>
  );
}
