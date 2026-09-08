import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { activosService, tiposDispositivoService } from "../../../api/activosService";
import { departamentosService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { EscanerInput } from "../../../components/activos/EscanerInput/EscanerInput";
import { EstadoActivo } from "../../../components/activos/EstadoActivo/EstadoActivo";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import "./Activos.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Activos" }];

const ESTADOS = [
  { valor: "en_uso", etiqueta: "En uso" },
  { valor: "en_bodega", etiqueta: "En bodega" },
  { valor: "en_mantenimiento", etiqueta: "En mantenimiento" },
  { valor: "dado_de_baja", etiqueta: "Dado de baja" },
];

export function ActivosList() {
  const puedeCrear = usePermission("activos.crear");
  const [searchParams] = useSearchParams();
  const [busqueda, setBusqueda] = useState("");
  const [tipos, setTipos] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);

  // El listado se puede abrir preseleccionado desde otras pantallas (p. ej.
  // "activos a cargo" de un empleado, o "requieren renovación" del panel de
  // sugerencias), así que los filtros arrancan desde la URL.
  const [filtrosIniciales] = useState(() => ({
    q: "",
    tipo: searchParams.get("tipo") || "",
    departamento: searchParams.get("departamento") || "",
    custodio: searchParams.get("custodio") || "",
    estado: searchParams.get("estado") || "",
    requiere_renovacion: searchParams.get("requiere_renovacion") || "",
  }));

  const cargar = useCallback((params) => activosService.list(params), []);
  const listado = useListadoPaginado(cargar, filtrosIniciales, "No se pudo cargar el inventario.");

  useEffect(() => {
    tiposDispositivoService
      .list({ page_size: 100 })
      .then((datos) => setTipos(datos.results ?? datos))
      .catch(() => setTipos([]));
    departamentosService
      .list({ page_size: 100 })
      .then((datos) => setDepartamentos(datos.results ?? datos))
      .catch(() => setDepartamentos([]));
  }, []);

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  return (
    <div className="activos-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2>Inventario de activos</h2>
        <div className="d-flex gap-2">
          <Link to="/admin/activos/escaner" className="btn btn-outline-primary btn-sm">
            <i className="bi bi-upc-scan me-1" aria-hidden="true" />
            Escanear
          </Link>
          {puedeCrear && (
            <Link to="/admin/activos/new" className="btn btn-primary btn-sm">
              Nuevo activo
            </Link>
          )}
        </div>
      </div>

      <EscanerInput
        className="mb-3"
        placeholder="Escanee una etiqueta o escriba código, serie, marca o custodio"
        onEscanear={(valor) => {
          setBusqueda(valor);
          listado.actualizarFiltros({ q: valor });
        }}
      />

      <form className="d-flex gap-2 mb-3 flex-wrap" onSubmit={handleBuscar}>
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Buscar"
          aria-label="Buscar activos"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por tipo"
          value={listado.filtros.tipo}
          onChange={(event) => listado.actualizarFiltros({ tipo: event.target.value })}
        >
          <option value="">Todos los tipos</option>
          {tipos.map((tipo) => (
            <option key={tipo.id} value={tipo.id}>
              {tipo.nombre}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por departamento"
          value={listado.filtros.departamento}
          onChange={(event) => listado.actualizarFiltros({ departamento: event.target.value })}
        >
          <option value="">Todas las áreas</option>
          {departamentos.map((departamento) => (
            <option key={departamento.id} value={departamento.id}>
              {departamento.nombre}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por estado"
          value={listado.filtros.estado}
          onChange={(event) => listado.actualizarFiltros({ estado: event.target.value })}
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((estado) => (
            <option key={estado.valor} value={estado.valor}>
              {estado.etiqueta}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por sugerencia de renovación"
          value={listado.filtros.requiere_renovacion}
          onChange={(event) => listado.actualizarFiltros({ requiere_renovacion: event.target.value })}
        >
          <option value="">Renovación: todos</option>
          <option value="true">Solo los sugeridos</option>
          <option value="false">Sin sugerencia</option>
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
              <th>Activo</th>
              <th>Tipo</th>
              <th>Custodio</th>
              <th>Área</th>
              <th>Estado</th>
              <th className="text-end" title="Intervenciones acumuladas">
                Mant.
              </th>
              <th>Renovación</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((activo) => (
              <tr key={activo.id}>
                <td>
                  <code className="codigo-barras">{activo.codigo_barras}</code>
                </td>
                <td>
                  <div>{activo.nombre}</div>
                  <small className="text-muted">
                    {activo.marca} {activo.modelo} · {activo.numero_serie}
                  </small>
                </td>
                <td>{activo.tipo_nombre}</td>
                <td>{activo.custodio_nombre || <span className="text-muted">Sin asignar</span>}</td>
                <td>{activo.departamento_nombre}</td>
                <td>
                  <EstadoActivo estado={activo.estado} etiqueta={activo.estado_display} />
                </td>
                <td className="text-end">{activo.total_mantenimientos}</td>
                <td>
                  {activo.requiere_renovacion ? (
                    <span className="badge text-bg-warning">
                      <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
                      Sugerida
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  <Link to={`/admin/activos/${activo.id}`} className="btn btn-outline-secondary btn-sm">
                    Ver ficha
                  </Link>
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-muted">
                  Sin activos que coincidan con los filtros
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
        etiqueta="activos"
      />
    </div>
  );
}
