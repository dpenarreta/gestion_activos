import { Button, Form } from 'react-bootstrap'
import { formatNumber } from '../../utils/format'
import { PAGE_SIZES_PERMITIDOS } from '../../config/pageSizes'


/**
 * Paginación reutilizable: selector de "registros por página" + resumen + navegación
 * (primera/anterior/siguiente/última). No sabe de dónde vienen los datos — la usan tanto
 * tablas paginadas en backend (`DetalleTable`) como tablas paginadas en memoria
 * (`RecuperadorCausalMatrix`), para no duplicar esta UI en cada una.
 */
export default function Pagination({
  idBase,
  paginaActual,
  totalPaginas,
  totalRegistros,
  pageSize,
  allowedPageSizes = PAGE_SIZES_PERMITIDOS,
  onCambiarPagina,
  onCambiarPageSize,
  cargando = false,
}) {
  const selectId = `pagination-page-size-${idBase}`
  const enPrimera = paginaActual <= 1 || cargando
  const enUltima = paginaActual >= totalPaginas || cargando

  const desde = totalRegistros === 0 ? 0 : (paginaActual - 1) * pageSize + 1
  const hasta = Math.min(paginaActual * pageSize, totalRegistros)

  return (
    <div className="pagination-bar">
      <div className="pagination-bar__selector">
        <Form.Label htmlFor={selectId} className="mb-0 me-2" style={{ fontSize: '0.85rem' }}>
          Mostrar
        </Form.Label>
        <Form.Select
          id={selectId}
          size="sm"
          style={{ width: 'auto', display: 'inline-block' }}
          value={pageSize}
          disabled={cargando}
          aria-label="Registros por página"
          onChange={(e) => onCambiarPageSize(Number(e.target.value))}
        >
          {allowedPageSizes.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </Form.Select>
        <span className="ms-2" style={{ fontSize: '0.85rem' }}>registros</span>
      </div>

      <div className="pagination-bar__resumen" role="status" aria-live="polite">
        {totalRegistros === 0
          ? 'No hay registros para mostrar.'
          : `Mostrando ${formatNumber(desde)} a ${formatNumber(hasta)} de ${formatNumber(totalRegistros)} registros`}
      </div>

      <div className="pagination-bar__controles">
        <Button
          size="sm"
          variant="outline-secondary"
          disabled={enPrimera}
          onClick={() => onCambiarPagina(1)}
          aria-label="Primera página"
        >
          «
        </Button>
        <Button
          size="sm"
          variant="outline-secondary"
          disabled={enPrimera}
          onClick={() => onCambiarPagina(paginaActual - 1)}
          aria-label="Página anterior"
        >
          ‹ Anterior
        </Button>
        <span className="pagination-bar__pagina" style={{ fontSize: '0.85rem' }}>
          Página {paginaActual} de {totalPaginas}
        </span>
        <Button
          size="sm"
          variant="outline-secondary"
          disabled={enUltima}
          onClick={() => onCambiarPagina(paginaActual + 1)}
          aria-label="Página siguiente"
        >
          Siguiente ›
        </Button>
        <Button
          size="sm"
          variant="outline-secondary"
          disabled={enUltima}
          onClick={() => onCambiarPagina(totalPaginas)}
          aria-label="Última página"
        >
          »
        </Button>
      </div>
    </div>
  )
}
