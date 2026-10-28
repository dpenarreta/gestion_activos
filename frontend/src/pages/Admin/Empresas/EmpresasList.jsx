import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import { empresasService } from "../../../api/empresasService";
import { FilaDeEstado } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Empresas.css";
import { useMultiempresa } from "../../../components/admin/AdminSidebar/SelectorEmpresa";

const FILTROS_INICIALES = {};

/**
 * Las empresas del grupo: cada una con su inventario, sus catálogos y sus
 * indicadores, sin ver los de las otras.
 *
 * Se listan todas y no solo aquellas en las que trabaja quien mira: esta es la
 * pantalla desde la que se crea la segunda empresa, y verse solo a sí misma
 * volvería imposible justamente eso. Quién llega hasta aquí lo decide
 * `empresas.ver`.
 */
export function EmpresasList() {
  const multiempresa = useMultiempresa();
  const puedeEditar = usePermission("empresas.editar");
  const [busqueda, setBusqueda] = useState("");
  const cargar = useCallback((params) => empresasService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el listado de empresas.",
  );

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  function limpiarFiltros() {
    setBusqueda("");
    listado.actualizarFiltros({ q: "" });
  }

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>{multiempresa ? "Empresas" : "Empresa"}</h2>
          <p className="mz-desc">
            {multiempresa
              ? "Todo lo que se registra pertenece a una empresa. Cambiar de empresa en el selector del menú cambia de dónde salen los datos: el inventario, los catálogos, el panel y los reportes pasan a ser los de la otra."
              : "Los datos de la empresa: su nombre, su identificación y su configuración. El sistema trabaja con una sola empresa."}
          </p>
        </div>
        {puedeEditar && multiempresa && (
          <div className="mz-view-actions">
            <Link to="/admin/empresas/new" className="btn btn-primary btn-sm">
              <Icon name="plus-lg" /> Nueva empresa
            </Link>
          </div>
        )}
      </div>

      <form className="mz-filter-bar" onSubmit={handleBuscar} role="search">
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar empresas</span>
          <input
            type="search"
            placeholder="Buscar por nombre"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
      </form>

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código</th>
              <th>Identificación</th>
              <th>Zona horaria</th>
              <th className="num">Usuarios</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {/* Cargando, error con reintento y un vacío que distingue «no hay
                empresas» de «la búsqueda no encuentra nada» (auditoría UX/UI,
                fase 2, 28/10/2026). */}
            <FilaDeEstado
              columnas={7}
              cargando={listado.isLoading && listado.resultados.length === 0}
              error={listado.error}
              onReintentar={listado.refresh}
              vacio={!listado.isLoading && listado.resultados.length === 0}
              textoVacio="Todavía no hay empresas registradas."
              hayFiltros={Boolean(listado.filtros.q)}
              onLimpiarFiltros={limpiarFiltros}
            />
            {!listado.error &&
              listado.resultados.map((empresa) => (
                <tr key={empresa.id}>
                  <td className="mz-strong">{empresa.nombre}</td>
                  <td className="mz-code">
                    <span
                      className="empresas-punto"
                      style={{ background: empresa.color }}
                      aria-hidden="true"
                    />
                    {empresa.codigo}
                  </td>
                  <td className="mz-mono mz-faint">
                    {empresa.identificacion || "—"}
                  </td>
                  <td className="mz-faint">{empresa.zona_horaria}</td>
                  <td className="num">
                    {empresa.usuarios}
                    {/* Una empresa sin nadie asignado no la ve nadie, y desde
                      fuera parece que el sistema perdió los datos. */}
                    {empresa.usuarios === 0 && (
                      <span className="mz-pill mz-pill--warn ms-2">
                        Sin usuarios
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`mz-pill ${empresa.activa ? "mz-pill--ok" : "mz-pill--neutral"}`}
                    >
                      {empresa.activa ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="acciones">
                    <Link
                      to={`/admin/empresas/${empresa.id}`}
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`${puedeEditar ? "Editar" : "Ver"} ${empresa.nombre}`}
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
        etiqueta="empresas"
      />
    </div>
  );
}
