import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ordenesService } from "../../api/ordenesService";
import { Icon } from "../../components/common/Icon/Icon";
import { Paginacion } from "../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../hooks/useListadoPaginado";
import { formatearFecha } from "../../utils/formato";
import {
  CumplimientoOrden,
  EstadoOrden,
  PrioridadOrden,
  Sede,
  moneda,
} from "./comunes";
import "./Ordenes.css";

/**
 * Órdenes de trabajo: el listado.
 *
 * Cada persona ve su recorte —todas, o las que pidió, las asignadas y las de
 * las sedes a su cargo—; la línea de arriba lo dice para que nadie crea que
 * faltan órdenes. El teléfono del solicitante llega enmascarado del servidor
 * a quien no lo necesita completo.
 */
export function OrdenesList() {
  const [catalogos, setCatalogos] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const cargar = useCallback((params) => ordenesService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    { q: "", estado: "", prioridad: "", region: "", abiertas: "true" },
    "No se pudieron cargar las órdenes.",
  );

  useEffect(() => {
    ordenesService
      .catalogos()
      .then(setCatalogos)
      .catch(() => setCatalogos(null));
  }, []);

  const puede = catalogos?.puede ?? {};

  return (
    <div className="ordenes-page">
      <div className="mz-view-head">
        <div>
          <h2>Órdenes de trabajo</h2>
          <p className="mz-desc">
            {catalogos
              ? `Mostrando ${listado.total} orden(es) · alcance: ${catalogos.alcance}`
              : "Mantenimiento de sedes y agencias."}
          </p>
        </div>
        <div className="mz-view-actions">
          {catalogos && !puede.crear && !puede.gestionar && (
            <span className="mz-pill ordenes-pill--info">Solo lectura</span>
          )}
          {puede.crear && (
            <Link
              className="btn btn-primary btn-sm"
              to="/admin/ordenes/lista/nueva"
            >
              <Icon name="plus-lg" /> Nueva orden
            </Link>
          )}
        </div>
      </div>

      <form
        className="mz-filter-bar"
        role="search"
        onSubmit={(evento) => {
          evento.preventDefault();
          listado.actualizarFiltros({ q: busqueda });
        }}
      >
        <label className="mz-fb-search" htmlFor="ot-buscar">
          <Icon name="search" />
          <span className="visually-hidden">Buscar</span>
          <input
            id="ot-buscar"
            type="search"
            placeholder="N.º, trabajo, sede o técnico"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
        </label>
        <Filtro
          id="ot-estado"
          etiqueta="Estado"
          valor={listado.filtros.estado}
          opciones={catalogos?.estados}
          onCambiar={(estado) => listado.actualizarFiltros({ estado })}
        />
        <Filtro
          id="ot-prioridad"
          etiqueta="Prioridad"
          valor={listado.filtros.prioridad}
          opciones={catalogos?.prioridades}
          onCambiar={(prioridad) => listado.actualizarFiltros({ prioridad })}
        />
        <Filtro
          id="ot-region"
          etiqueta="Región"
          valor={listado.filtros.region}
          opciones={catalogos?.regiones}
          onCambiar={(region) => listado.actualizarFiltros({ region })}
        />
        <div className="mz-inline-field">
          <label htmlFor="ot-abiertas">Mostrar</label>
          <select
            id="ot-abiertas"
            className="form-select form-select-sm"
            value={listado.filtros.abiertas}
            onChange={(evento) =>
              listado.actualizarFiltros({ abiertas: evento.target.value })
            }
          >
            <option value="true">Solo las abiertas</option>
            <option value="">Todas</option>
          </select>
        </div>
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
      </form>

      {listado.error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {listado.error}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>N.º orden</th>
              <th>Sede</th>
              <th>Trabajo</th>
              <th>Prioridad</th>
              <th>Estado</th>
              <th>Responsable</th>
              <th>Programada</th>
              <th>Cumplimiento</th>
              <th>Contacto</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((orden) => (
              <tr key={orden.id}>
                <td className="mz-mono">
                  <Link to={`/admin/ordenes/lista/${orden.id}`}>
                    {orden.numero}
                  </Link>
                </td>
                <td>
                  <Sede sede={orden.sede} />
                </td>
                <td>
                  <span className="mz-strong">{orden.titulo}</span>
                  <div className="mz-small mz-faint">
                    {orden.categoria_display}
                  </div>
                </td>
                <td>
                  <PrioridadOrden orden={orden} />
                </td>
                <td>
                  <EstadoOrden orden={orden} />
                </td>
                <td>{orden.responsable}</td>
                <td className="mz-mono">
                  {orden.fecha_programada
                    ? formatearFecha(orden.fecha_programada)
                    : "—"}
                </td>
                <td>
                  <CumplimientoOrden orden={orden} />
                </td>
                <td className="mz-mono">{orden.contacto || "—"}</td>
                <td className="num mz-mono">{moneda(orden.total)}</td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={10}>
                  No hay órdenes en su alcance con estos filtros
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
        etiqueta="órdenes"
      />
      {catalogos && (
        <p className="mz-small mz-faint">
          {puede.ver_contacto
            ? "Su perfil ve el contacto completo del solicitante; cada consulta queda registrada."
            : "Teléfonos enmascarados: su perfil no necesita el dato completo para su función."}
        </p>
      )}
    </div>
  );
}

function Filtro({ id, etiqueta, valor, opciones, onCambiar }) {
  return (
    <div className="mz-inline-field">
      <label htmlFor={id}>{etiqueta}</label>
      <select
        id={id}
        className="form-select form-select-sm"
        value={valor}
        onChange={(evento) => onCambiar(evento.target.value)}
      >
        <option value="">Todas</option>
        {(opciones ?? []).map((opcion) => (
          <option key={opcion.valor} value={opcion.valor}>
            {opcion.etiqueta}
          </option>
        ))}
      </select>
    </div>
  );
}
