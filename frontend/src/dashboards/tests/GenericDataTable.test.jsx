import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GenericDataTable from '../components/dashboard-generic/GenericDataTable'
import { PAGE_SIZES_PERMITIDOS } from '../config/pageSizes'

function textoColumna(contenedor, indiceColumna) {
  return [...contenedor.querySelectorAll(`tbody tr td:nth-child(${indiceColumna + 1})`)].map((td) => td.textContent)
}

describe('GenericDataTable', () => {
  it('por defecto muestra el párrafo de "Hallazgos clave"', () => {
    render(
      <GenericDataTable data={{ titulo: 'Tabla', columnas: ['Producto', 'Ventas'], filas: [['A', 100]] }} />,
    )
    expect(screen.getByText('Hallazgos clave', { exact: false })).toBeInTheDocument()
  })

  it('con mostrarHallazgos={false}, no muestra el párrafo de "Hallazgos clave"', () => {
    render(
      <GenericDataTable
        data={{ titulo: 'Tabla', columnas: ['Producto', 'Ventas'], filas: [['A', 100]] }}
        mostrarHallazgos={false}
      />,
    )
    expect(screen.queryByText('Hallazgos clave', { exact: false })).not.toBeInTheDocument()
  })

  it('por defecto no muestra la etiqueta "Histórica"', () => {
    render(
      <GenericDataTable data={{ titulo: 'Tabla', columnas: ['Producto', 'Ventas'], filas: [['A', 100]] }} />,
    )
    expect(screen.queryByText('Histórica')).not.toBeInTheDocument()
  })

  it('con esHistorica, muestra la etiqueta "Histórica" junto al título', () => {
    render(
      <GenericDataTable
        data={{ titulo: 'Tabla', columnas: ['Producto', 'Ventas'], filas: [['A', 100]] }}
        esHistorica
      />,
    )
    expect(screen.getByText('Histórica')).toBeInTheDocument()
  })


  it('la forma simple (categorias/valores) renderiza dos columnas', () => {
    const { container } = render(<GenericDataTable data={{ titulo: 'Tabla', categorias: ['Quito', 'Guayaquil'], valores: [100, 50] }} />)
    expect(screen.getByText('Categoría')).toBeInTheDocument()
    expect(screen.getByText('Valor')).toBeInTheDocument()
    expect(container.querySelector('tbody').textContent).toContain('Quito')
  })

  it('la forma multi-columna (columnas/filas/total) renderiza todas las columnas y la fila de total', () => {
    const { container } = render(
      <GenericDataTable
        data={{
          titulo: 'Tabla 1',
          columnas: ['Producto', 'Ventas', 'Costo', '% del total'],
          filas: [['Producto A', 100, 50, 60], ['Producto B', 50, 20, 40]],
          total: ['Total', 150, 70, 100],
        }}
      />,
    )
    expect(screen.getByText('Producto')).toBeInTheDocument()
    expect(screen.getByText('% del total')).toBeInTheDocument()
    expect(container.querySelector('tbody').textContent).toContain('Producto A')
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('las celdas de texto ya formateadas (p. ej. "38.8%") se muestran tal cual, sin reformatear', () => {
    const { container } = render(
      <GenericDataTable
        data={{
          titulo: 'Tabla 1', columnas: ['Producto', 'Margen'], filas: [['Producto A', '38.8%']], total: ['Total', '39.6%'],
        }}
      />,
    )
    expect(container.querySelector('tbody').textContent).toContain('38.8%')
  })

  it('multi-columna: un clic en el encabezado ordena ascendente y un segundo clic invierte a descendente', async () => {
    const usuario = userEvent.setup()
    const { container } = render(
      <GenericDataTable
        data={{
          titulo: 'Tabla 1',
          columnas: ['Producto', 'Ventas'],
          filas: [['Producto B', 50], ['Producto A', 100], ['Producto C', 20]],
          total: ['Total', 170],
        }}
      />,
    )

    const encabezadoVentas = screen.getByText('Ventas')
    await usuario.click(encabezadoVentas)
    expect(textoColumna(container, 0)).toEqual(['Producto C', 'Producto B', 'Producto A'])
    expect(screen.getByText('Ventas ▲')).toBeInTheDocument()

    await usuario.click(encabezadoVentas)
    expect(textoColumna(container, 0)).toEqual(['Producto A', 'Producto B', 'Producto C'])
    expect(screen.getByText('Ventas ▼')).toBeInTheDocument()
  })

  it('multi-columna: la fila de totales nunca participa del orden, siempre queda al final', async () => {
    const usuario = userEvent.setup()
    render(
      <GenericDataTable
        data={{
          titulo: 'Tabla 1',
          columnas: ['Producto', 'Ventas'],
          filas: [['Producto B', 50], ['Producto A', 100]],
          total: ['Total', 150],
        }}
      />,
    )

    await usuario.click(screen.getByText('Ventas'))
    const filas = screen.getAllByRole('row')
    expect(filas[filas.length - 1]).toHaveTextContent('Total')
  })

  it('forma simple: ordenar por Valor reordena las categorías', async () => {
    const usuario = userEvent.setup()
    const { container } = render(
      <GenericDataTable data={{ titulo: 'Tabla', categorias: ['Quito', 'Guayaquil', 'Cuenca'], valores: [100, 300, 50] }} />,
    )

    await usuario.click(screen.getByText('Valor'))
    expect(textoColumna(container, 0)).toEqual(['Cuenca', 'Quito', 'Guayaquil'])
  })

  describe('paginación', () => {
    function filasMulti(cantidad) {
      return Array.from({ length: cantidad }, (_, i) => [`Producto ${i + 1}`, i + 1])
    }

    it('ofrece exactamente los tamaños de página permitidos del proyecto', () => {
      // `.claude/rules/dashboards.md` fija un único conjunto {5,10,25,50,100}, validado también en
      // el backend. Esta tabla tenía su propia lista con un 20 (no permitido) y sin el 100.
      render(
        <GenericDataTable data={{ titulo: 'Tabla 1', columnas: ['Producto', 'Ventas'], filas: filasMulti(12), total: ['Total', 78] }} />,
      )
      const opciones = [...screen.getByLabelText('Registros por página').options].map((o) => Number(o.value))
      expect(opciones).toEqual(PAGE_SIZES_PERMITIDOS)
    })

    it('con menos de 5 filas, no muestra el selector de cantidad ni el paginador', () => {
      render(
        <GenericDataTable data={{ titulo: 'Tabla 1', columnas: ['Producto', 'Ventas'], filas: filasMulti(4), total: ['Total', 10] }} />,
      )
      expect(screen.queryByLabelText('Registros por página')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Página siguiente' })).not.toBeInTheDocument()
    })

    it('con exactamente 5 filas (llenan la página 1 por defecto), tampoco muestra el paginador', () => {
      render(
        <GenericDataTable data={{ titulo: 'Tabla 1', columnas: ['Producto', 'Ventas'], filas: filasMulti(5), total: ['Total', 15] }} />,
      )
      expect(screen.queryByLabelText('Registros por página')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Página siguiente' })).not.toBeInTheDocument()
    })

    it('con más de 5 filas, por defecto muestra solo las primeras 5 y el paginador', () => {
      const { container } = render(
        <GenericDataTable data={{ titulo: 'Tabla 1', columnas: ['Producto', 'Ventas'], filas: filasMulti(12), total: ['Total', 78] }} />,
      )
      expect(textoColumna(container, 0)).toEqual(['Producto 1', 'Producto 2', 'Producto 3', 'Producto 4', 'Producto 5'])
      expect(screen.getByLabelText('Registros por página')).toHaveValue('5')
      expect(screen.getByText(/Mostrando 1 a 5 de 12 registros/)).toBeInTheDocument()
      // La fila de totales resume las 12 filas completas, no solo la página actual.
      expect(screen.getByText('78')).toBeInTheDocument()
    })

    it('cambiar la cantidad de filas por página muestra más filas', async () => {
      const usuario = userEvent.setup()
      const { container } = render(
        <GenericDataTable data={{ titulo: 'Tabla 1', columnas: ['Producto', 'Ventas'], filas: filasMulti(12), total: ['Total', 78] }} />,
      )
      await usuario.selectOptions(screen.getByLabelText('Registros por página'), '10')
      expect(textoColumna(container, 0)).toHaveLength(10)
    })

    it('"Página siguiente" muestra el resto de las filas', async () => {
      const usuario = userEvent.setup()
      const { container } = render(
        <GenericDataTable data={{ titulo: 'Tabla 1', columnas: ['Producto', 'Ventas'], filas: filasMulti(7), total: ['Total', 28] }} />,
      )
      await usuario.click(screen.getByRole('button', { name: 'Página siguiente' }))
      expect(textoColumna(container, 0)).toEqual(['Producto 6', 'Producto 7'])
    })

    it('ordenar por una columna vuelve a la página 1', async () => {
      const usuario = userEvent.setup()
      render(
        <GenericDataTable data={{ titulo: 'Tabla 1', columnas: ['Producto', 'Ventas'], filas: filasMulti(7), total: ['Total', 28] }} />,
      )
      await usuario.click(screen.getByRole('button', { name: 'Página siguiente' }))
      expect(screen.getByText(/Página 2 de 2/)).toBeInTheDocument()

      await usuario.click(screen.getByText('Ventas'))
      expect(screen.getByText(/Página 1 de 2/)).toBeInTheDocument()
    })

    it('forma simple: con más de 5 filas también aparece el paginador', () => {
      render(
        <GenericDataTable data={{
          titulo: 'Tabla', categorias: ['A', 'B', 'C', 'D', 'E', 'F'], valores: [1, 2, 3, 4, 5, 6],
        }}
        />,
      )
      expect(screen.getByLabelText('Registros por página')).toBeInTheDocument()
      expect(screen.getByText(/Mostrando 1 a 5 de 6 registros/)).toBeInTheDocument()
    })
  })

  describe('columna "Resultado" (tabla de cumplimiento de metas)', () => {
    function tablaCumplimiento(resultados) {
      return {
        titulo: 'Cumplimiento',
        columnas: ['Tramo', 'Saldo', '% acumulado', 'Resultado'],
        filas: resultados.map((resultado, i) => [`Tramo ${i + 1}`, 100, 10, resultado]),
        total: null,
      }
    }

    it('"Cumple" se muestra como badge verde (bg="success")', () => {
      const { container } = render(<GenericDataTable data={tablaCumplimiento(['Cumple'])} />)
      const badge = container.querySelector('tbody .badge')
      expect(badge).toHaveTextContent('Cumple')
      expect(badge).toHaveClass('bg-success')
    })

    it('"Sin meta" se muestra como badge gris (bg="secondary")', () => {
      const { container } = render(<GenericDataTable data={tablaCumplimiento(['Sin meta'])} />)
      const badge = container.querySelector('tbody .badge')
      expect(badge).toHaveTextContent('Sin meta')
      expect(badge).toHaveClass('bg-secondary')
    })

    it('"No cumple (...)" se muestra como badge rojo (bg="danger")', () => {
      const { container } = render(<GenericDataTable data={tablaCumplimiento(['No cumple (menor al mínimo (50))'])} />)
      const badge = container.querySelector('tbody .badge')
      expect(badge).toHaveTextContent('No cumple (menor al mínimo (50))')
      expect(badge).toHaveClass('bg-danger')
    })

    it('una tabla sin columna "Resultado" sigue mostrando texto plano, sin badges', () => {
      const { container } = render(
        <GenericDataTable data={{ titulo: 'Tabla', columnas: ['Producto', 'Ventas'], filas: [['A', 100]], total: ['Total', 100] }} />,
      )
      expect(container.querySelector('.badge')).not.toBeInTheDocument()
    })
  })
})
