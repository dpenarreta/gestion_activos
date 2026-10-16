import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BuscadorDeudor from '../components/dashboard-directorio/BuscadorDeudor'
import { buscarDeudores, obtenerDetalleDeudor } from '../services/dashboardLayoutService'

vi.mock('../services/dashboardLayoutService', () => ({
  buscarDeudores: vi.fn(),
  obtenerDetalleDeudor: vi.fn(),
}))

/**
 * Consulta puntual de un deudor.
 *
 * Lo que importa verificar acá es el comportamiento que decide la utilidad de la sección: que no
 * sume dos clientes distintos por una coincidencia parcial, y que un tramo sin documentos se vea
 * en 0 en vez de desaparecer (es información: dice que ese cliente no tiene mora en ese tramo).
 */

const COMPONENTE = {
  content: { titulo: 'CONSULTA POR CLIENTE' },
  mapeo: {
    columna_id: 'Cliente', columna_ruc: 'Ruc Cliente',
    columna_fecha: 'Fecha de Vencimiento', columna_valor: 'Saldo',
  },
  config: { bloque: 'consulta-deudor', columnas_detalle: ['Número de Documento', 'Saldo'] },
}

const DETALLE = {
  identidad: '111',
  nombre: 'TRANSEXPRESS',
  total: 1000,
  cantidad_filas: 2,
  tramos: {
    categorias: ['Anticipada', '30 días', '60 días', '90 días', '120 días', '+120 días'],
    valores: [800, 0, 0, 0, 0, 200],
  },
  columnas: ['Número de Documento', 'Saldo'],
  filas: [['A-1', 800], ['A-2', 200]],
}

function pintar() {
  return render(<BuscadorDeudor componente={COMPONENTE} dashboardId="directorio-cartera" />)
}

async function consultar(texto = 'transex') {
  const usuario = userEvent.setup()
  await usuario.type(screen.getByLabelText('Nombre o identificador del cliente'), texto)
  await usuario.click(screen.getByRole('button', { name: 'Consultar' }))
  return usuario
}

describe('BuscadorDeudor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('con una sola coincidencia abre el detalle directo, sin un clic que no decide nada', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: [{ identidad: '111', nombre: 'TRANSEXPRESS', saldo: 1000, filas: 2 }], total: 1 })
    obtenerDetalleDeudor.mockResolvedValue(DETALLE)
    pintar()
    await consultar()
    await waitFor(() => expect(screen.getByText(/TRANSEXPRESS —/)).toBeInTheDocument())
    expect(obtenerDetalleDeudor).toHaveBeenCalled()
  })

  it('con varias coincidencias hace elegir, en vez de sumar clientes distintos', async () => {
    buscarDeudores.mockResolvedValue({
      coincidencias: [
        { identidad: '111', nombre: 'TRANSEXPRESS', saldo: 1000, filas: 2 },
        { identidad: '222', nombre: 'TRANSEXPORT SA', saldo: 50, filas: 1 },
      ],
      total: 2,
    })
    pintar()
    await consultar()
    await waitFor(() => expect(screen.getByText('2 coincidencias — elegí una:')).toBeInTheDocument())
    expect(obtenerDetalleDeudor).not.toHaveBeenCalled()
    expect(screen.getByText('TRANSEXPORT SA')).toBeInTheDocument()
  })

  it('al elegir una de las coincidencias se pide su detalle', async () => {
    buscarDeudores.mockResolvedValue({
      coincidencias: [
        { identidad: '111', nombre: 'TRANSEXPRESS', saldo: 1000, filas: 2 },
        { identidad: '222', nombre: 'TRANSEXPORT SA', saldo: 50, filas: 1 },
      ],
      total: 2,
    })
    obtenerDetalleDeudor.mockResolvedValue(DETALLE)
    pintar()
    const usuario = await consultar()
    await waitFor(() => expect(screen.getByText('TRANSEXPORT SA')).toBeInTheDocument())
    await usuario.click(screen.getByText('TRANSEXPORT SA'))
    await waitFor(() => expect(obtenerDetalleDeudor).toHaveBeenCalledWith(
      'directorio-cartera', expect.objectContaining({ identidad: '222' }),
    ))
  })

  it('los tramos sin documentos se muestran en 0, no se ocultan', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: [{ identidad: '111', nombre: 'TRANSEXPRESS', saldo: 1000, filas: 2 }], total: 1 })
    obtenerDetalleDeudor.mockResolvedValue(DETALLE)
    pintar()
    await consultar()
    await waitFor(() => expect(screen.getByText('60 días')).toBeInTheDocument())
    // Los seis tramos están presentes aunque cuatro valgan cero.
    for (const tramo of ['Anticipada', '30 días', '60 días', '90 días', '120 días', '+120 días']) {
      expect(screen.getByText(tramo)).toBeInTheDocument()
    }
    expect(screen.getAllByText('$0').length).toBe(4)
  })

  it('el detalle muestra solo las columnas configuradas en el componente', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: [{ identidad: '111', nombre: 'TRANSEXPRESS', saldo: 1000, filas: 2 }], total: 1 })
    obtenerDetalleDeudor.mockResolvedValue(DETALLE)
    pintar()
    await consultar()
    await waitFor(() => expect(screen.getByText('NÚMERO DE DOCUMENTO')).toBeInTheDocument())
    expect(obtenerDetalleDeudor).toHaveBeenCalledWith('directorio-cartera', expect.objectContaining({
      columnasDetalle: ['Número de Documento', 'Saldo'],
    }))
  })

  it('un valor vacío se muestra como raya, no como "null"', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: [{ identidad: '111', nombre: 'TRANSEXPRESS', saldo: 1000, filas: 1 }], total: 1 })
    obtenerDetalleDeudor.mockResolvedValue({ ...DETALLE, filas: [['A-1', null]] })
    pintar()
    await consultar()
    await waitFor(() => expect(screen.getByText('A-1')).toBeInTheDocument())
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('sin coincidencias lo dice, en vez de dejar la sección en blanco', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: [], total: 0 })
    pintar()
    await consultar('inexistente')
    await waitFor(() => expect(screen.getByText(/No hay clientes que coincidan/)).toBeInTheDocument())
  })

  it('un error del backend se muestra con su mensaje', async () => {
    buscarDeudores.mockRejectedValue({ response: { data: { mensaje: 'Escribí al menos dos caracteres para buscar.' } } })
    pintar()
    await consultar('t')
    await waitFor(() => expect(screen.getByText('Escribí al menos dos caracteres para buscar.')).toBeInTheDocument())
  })

  it('las columnas del mapeo viajan en la consulta, para que la sección siga siendo reconfigurable', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: [], total: 0 })
    pintar()
    await consultar()
    expect(buscarDeudores).toHaveBeenCalledWith('directorio-cartera', expect.objectContaining({
      columnas: { nombre: 'Cliente', ruc: 'Ruc Cliente', fecha: 'Fecha de Vencimiento', valor: 'Saldo' },
    }))
  })
})


describe('BuscadorDeudor — sugerencias mientras se escribe', () => {
  /**
   * Lo que se protege acá no es que "aparezca una lista", sino las dos cosas que hacen que un
   * buscador así sea usable o insoportable: que no dispare una petición por tecla, y que una
   * respuesta lenta de un texto viejo no pise a la del texto que está escrito.
   */

  const COINCIDENCIAS = [
    { identidad: '111', nombre: 'TRANSEXPRESS', saldo: 1000, filas: 2 },
    { identidad: '222', nombre: 'TRANSEXPORT SA', saldo: 50, filas: 1 },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function escribir(texto) {
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await usuario.type(screen.getByLabelText('Nombre o identificador del cliente'), texto)
    return usuario
  }

  it('no pide una búsqueda por cada tecla, sino una vez que se deja de escribir', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: COINCIDENCIAS, total: 2 })
    pintar()
    await escribir('transex')

    expect(buscarDeudores).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(buscarDeudores).toHaveBeenCalledTimes(1)
    expect(buscarDeudores.mock.calls[0][1].texto).toBe('transex')
  })

  it('con menos de dos caracteres no molesta al servidor', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: [], total: 0 })
    pintar()
    await escribir('t')
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(buscarDeudores).not.toHaveBeenCalled()
  })

  it('muestra las sugerencias y al elegir una abre su detalle', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: COINCIDENCIAS, total: 2 })
    obtenerDetalleDeudor.mockResolvedValue(DETALLE)
    pintar()
    await escribir('transex')
    await act(async () => { vi.advanceTimersByTime(400) })

    const opciones = await screen.findAllByRole('option')
    expect(opciones).toHaveLength(2)

    fireEvent.mouseDown(screen.getByText('TRANSEXPORT SA'))
    await waitFor(() => expect(obtenerDetalleDeudor).toHaveBeenCalledWith(
      'directorio-cartera', expect.objectContaining({ identidad: '222' }),
    ))
  })

  it('se puede elegir con el teclado, sin tocar el mouse', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: COINCIDENCIAS, total: 2 })
    obtenerDetalleDeudor.mockResolvedValue(DETALLE)
    pintar()
    const usuario = await escribir('transex')
    await act(async () => { vi.advanceTimersByTime(400) })
    await screen.findAllByRole('option')

    await usuario.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(obtenerDetalleDeudor).toHaveBeenCalledWith(
      'directorio-cartera', expect.objectContaining({ identidad: '222' }),
    ))
  })

  it('al elegir una sugerencia no se vuelve a abrir la lista sobre el resultado', async () => {
    // El campo queda con el nombre elegido; sin desactivar la sugerencia, ese texto dispararía
    // otra consulta y la lista taparía el detalle que se acaba de abrir.
    buscarDeudores.mockResolvedValue({ coincidencias: COINCIDENCIAS, total: 2 })
    obtenerDetalleDeudor.mockResolvedValue(DETALLE)
    pintar()
    await escribir('transex')
    await act(async () => { vi.advanceTimersByTime(400) })
    await screen.findAllByRole('option')

    fireEvent.mouseDown(screen.getByText('TRANSEXPRESS'))
    await waitFor(() => expect(obtenerDetalleDeudor).toHaveBeenCalled())
    buscarDeudores.mockClear()
    await act(async () => { vi.advanceTimersByTime(600) })

    expect(buscarDeudores).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('una respuesta que llega tarde no pisa a la del texto actual', async () => {
    // El caso que ensucia estos buscadores: "cor" tarda, "corporacion" contesta antes, y cuando
    // por fin llega "cor" reemplaza la lista por sugerencias que no corresponden a lo escrito.
    let resolverPrimera
    buscarDeudores
      .mockImplementationOnce(() => new Promise((resolve) => { resolverPrimera = resolve }))
      .mockResolvedValue({ coincidencias: [COINCIDENCIAS[1]], total: 1 })
    pintar()

    await escribir('tra')
    await act(async () => { vi.advanceTimersByTime(400) })
    await escribir('nsexport')
    await act(async () => { vi.advanceTimersByTime(400) })
    await screen.findByText('TRANSEXPORT SA')

    await act(async () => {
      resolverPrimera({ coincidencias: COINCIDENCIAS, total: 2 })
    })

    expect(screen.queryByText('TRANSEXPRESS')).not.toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  it('avisa cuántas coincidencias quedaron fuera de la lista', async () => {
    const muchas = Array.from({ length: 12 }, (_, i) => (
      { identidad: `id-${i}`, nombre: `CLIENTE ${i}`, saldo: 10, filas: 1 }
    ))
    buscarDeudores.mockResolvedValue({ coincidencias: muchas, total: 40 })
    pintar()
    await escribir('cliente')
    await act(async () => { vi.advanceTimersByTime(400) })

    expect(await screen.findByText(/y 32 más/)).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(8)
  })
})


describe('BuscadorDeudor — aviso de identidad dudosa', () => {
  /**
   * Dos empresas homónimas con RUC distinto salían en la lista como filas idénticas: mismo
   * nombre, mismo aspecto, y elegir una era adivinar. Y un RUC con dos razones sociales suma
   * bien el saldo pero muestra el nombre de la primera fila, así que el mismo cliente puede
   * aparecer con otro nombre según el archivo. Ninguna de las dos la detecta el resto del
   * informe, que agrupa por identidad y sigue.
   */

  const HOMONIMAS = [
    { identidad: '333', nombre: 'DOBLE IDENTIDAD', saldo: 10, filas: 1, otros_identificadores: ['444'], otros_nombres: [] },
    { identidad: '444', nombre: 'DOBLE IDENTIDAD', saldo: 20, filas: 1, otros_identificadores: ['333'], otros_nombres: [] },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('distingue dos clientes homónimos mostrando su identificador', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: HOMONIMAS, total: 2 })
    pintar()
    await consultar('doble')

    await waitFor(() => expect(screen.getByText('333')).toBeInTheDocument())
    expect(screen.getByText('444')).toBeInTheDocument()
  })

  it('avisa que el nombre está repartido en varios identificadores', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: HOMONIMAS, total: 2 })
    pintar()
    await consultar('doble')

    await waitFor(() => expect(
      screen.getAllByText(/también figura con el identificador 444/),
    ).not.toHaveLength(0))
  })

  it('en el detalle avisa que el identificador tiene otros nombres, y acota a qué corresponden las cifras', async () => {
    buscarDeudores.mockResolvedValue({
      coincidencias: [{ identidad: '555', nombre: 'MUTANTE S.A.', saldo: 70, filas: 2, otros_identificadores: [], otros_nombres: ['MUTANTE SA'] }],
      total: 1,
    })
    obtenerDetalleDeudor.mockResolvedValue({
      ...DETALLE, identidad: '555', nombre: 'MUTANTE S.A.',
      otros_identificadores: [], otros_nombres: ['MUTANTE SA'],
    })
    pintar()
    await consultar('mutante')

    await waitFor(() => expect(screen.getByText(/Revisá la identidad de este cliente/)).toBeInTheDocument())
    expect(screen.getByText(/también figura con el nombre MUTANTE SA/)).toBeInTheDocument()
  })

  it('un cliente sin problemas no muestra ninguna advertencia', async () => {
    buscarDeudores.mockResolvedValue({
      coincidencias: [{ identidad: '111', nombre: 'TRANSEXPRESS', saldo: 1000, filas: 2, otros_identificadores: [], otros_nombres: [] }],
      total: 1,
    })
    obtenerDetalleDeudor.mockResolvedValue({ ...DETALLE, otros_identificadores: [], otros_nombres: [] })
    pintar()
    await consultar()

    await waitFor(() => expect(screen.getByText(/TRANSEXPRESS —/)).toBeInTheDocument())
    expect(screen.queryByText(/Revisá la identidad/)).not.toBeInTheDocument()
  })

  it('sin los campos del aviso (una respuesta vieja en caché) no rompe', async () => {
    buscarDeudores.mockResolvedValue({ coincidencias: [{ identidad: '111', nombre: 'TRANSEXPRESS', saldo: 1000, filas: 2 }], total: 1 })
    obtenerDetalleDeudor.mockResolvedValue(DETALLE)
    pintar()
    await consultar()

    await waitFor(() => expect(screen.getByText(/TRANSEXPRESS —/)).toBeInTheDocument())
    expect(screen.queryByText(/Revisá la identidad/)).not.toBeInTheDocument()
  })
})


describe('BuscadorDeudor — cuando el origen no trae identificador', () => {
  /**
   * El caso de producción: la vista devuelve el nombre del cliente y nada más. El campo decía
   * "Nombre o identificador del cliente", así que quien pegaba un RUC y no encontraba nada
   * concluía —con razón -- que el buscador estaba roto, cuando el dato no está en el archivo.
   */

  const SIN_IDENTIFICADOR = {
    ...COMPONENTE,
    mapeo: { ...COMPONENTE.mapeo, columna_ruc: '' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('el campo no ofrece buscar por identificador', () => {
    render(<BuscadorDeudor componente={SIN_IDENTIFICADOR} dashboardId="directorio-cartera" />)
    expect(screen.getByLabelText('Nombre del cliente')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre o identificador del cliente')).not.toBeInTheDocument()
  })

  it('con identificador configurado sí lo ofrece', () => {
    render(<BuscadorDeudor componente={COMPONENTE} dashboardId="directorio-cartera" />)
    expect(screen.getByLabelText('Nombre o identificador del cliente')).toBeInTheDocument()
  })
})
