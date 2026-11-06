import { useCallback, useRef } from "react";
import { Link } from "react-router-dom";

import { concesionariosService } from "../../../api/organizacionService";
import { FilaDeEstado } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { AnuncioDeResultados } from "../../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { useBusquedaEnVivo } from "../../../hooks/useBusquedaEnVivo";
import { usePermission } from "../../../hooks/usePermission";
import "./Organizacion.css";

const FILTROS_INICIALES = { q: "", activo: "" };

/**
 * De quién son los equipos que no compró la empresa.
 *
 * **No es el catálogo de proveedores.** Al proveedor se le compró el equipo, y
 * entonces el equipo es nuestro. El concesionario es su dueño: lo pone para
 * operar con nosotros, la compra corre por su cuenta y el mantenimiento por la
 * nuestra. Son dos preguntas distintas —«a quién le compramos» y «de quién es
 * esto»— y por eso hay dos catálogos.
 *
 * La columna de equipos es la razón de que la pantalla exista: dice de un
 * vistazo qué hay que devolverle a cada partner si termina la concesión.
 */
export function ConcesionariosList() {
  const puedeEditar = usePermission("organizacion.editar");
  const cargar = useCallback(
    (params) => concesionariosService.list(params),
    [],
  );
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el listado de concesionarios.",
  );
  // Filtra mientras se escribe (búsqueda en vivo, 06/11/2026); Enter
  // aplica sin esperar.
  // El buscador, para devolverle el foco al limpiar.
  const campoBusqueda = useRef(null);
  const busqueda = useBusquedaEnVivo({
    inicial: listado.filtros.q,
    alBuscar: (q) => listado.actualizarFiltros({ q }),
  });

  const hayFiltros = Object.values(listado.filtros).some(Boolean);

  function handleBuscar(event) {
    event.preventDefault();
    busqueda.buscarYa();
  }

  // También vacía la caja de búsqueda: si no, el texto seguiría ahí
  // diciendo un filtro que ya no se aplica.
  function limpiarFiltros() {
    busqueda.fijar("");
    listado.actualizarFiltros(FILTROS_INICIALES);
  }

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Concesionarios</h2>
          <p className="mz-desc">
            Partners que ponen equipos para operar con nosotros. La compra corre
            por su cuenta y el mantenimiento por la nuestra, así que el equipo
            se atiende igual que el propio pero no cuenta como patrimonio de la
            empresa.
          </p>
        </div>
        {puedeEditar && (
          <div className="mz-view-actions">
            <Link
              to="/admin/organizacion/concesionarios/new"
              className="btn btn-primary btn-sm"
            >
              <Icon name="plus-lg" /> Nuevo concesionario
            </Link>
          </div>
        )}
      </div>

      <form className="mz-filter-bar" onSubmit={handleBuscar} role="search">
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar concesionarios</span>
          <input
            type="search"
            placeholder="Buscar por nombre, RUC o contacto"
            ref={campoBusqueda}
            {...busqueda.propsCampo}
          />
        </label>
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por estado"
          value={listado.filtros.activo}
          onChange={(event) =>
            listado.actualizarFiltros({ activo: event.target.value })
          }
        >
          <option value="">Todos</option>
          <option value="true">Activos</option>
          <option value="false">Dados de baja</option>
        </select>
      </form>
      <AnuncioDeResultados
        termino={listado.filtros.q}
        total={listado.total}
        cargando={listado.isLoading}
      />

      <div aria-busy={listado.isLoading} className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Identificación</th>
              <th>Contacto</th>
              <th className="num">Equipos suyos</th>
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
              textoVacio="Todavía no hay concesionarios registrados."
              hayFiltros={hayFiltros}
              onLimpiarFiltros={limpiarFiltros}
              termino={listado.filtros.q}
              campoBusquedaRef={campoBusqueda}
            />
            {!listado.error &&
              listado.resultados.map((concesionario) => (
                <tr key={concesionario.id}>
                  <td className="mz-strong">{concesionario.nombre}</td>
                  <td className="mz-mono mz-faint">
                    {concesionario.identificacion || "—"}
                  </td>
                  <td>
                    {concesionario.contacto || (
                      <span className="mz-faint">—</span>
                    )}
                    {concesionario.telefono && (
                      <div className="mz-faint mz-small">
                        {concesionario.telefono}
                      </div>
                    )}
                  </td>
                  <td className="num">
                    {concesionario.total_activos > 0 ? (
                      <Link
                        to={`/activos?propiedad=concesion&concesionario=${concesionario.id}`}
                      >
                        {concesionario.total_activos}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td>
                    <span
                      className={`mz-pill ${concesionario.activo ? "mz-pill--ok" : "mz-pill--neutral"}`}
                    >
                      {concesionario.activo ? "Activo" : "De baja"}
                    </span>
                  </td>
                  <td className="acciones">
                    <Link
                      to={`/admin/organizacion/concesionarios/${concesionario.id}`}
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`${puedeEditar ? "Editar" : "Ver"} ${concesionario.nombre}`}
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
        etiqueta="concesionarios"
      />
    </div>
  );
}
