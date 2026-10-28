import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import DirectorioSeccion from '../components/dashboard-directorio/DirectorioSeccion'

/**
 * Renderers propios del Dashboard Directorio.
 *
 * Lo que importa verificar acá es que DERIVEN la presentación del contenido genérico y del mapeo,
 * en vez de mostrar valores guardados: es lo que hace que las secciones sigan siendo correctas
 * después de reconfigurarlas desde "Configurar componente".
 */

function concentracion({ topN = 16, titulo } = {}) {
  return {
    config: { bloque: 'concentracion' },
    mapeo: { top_n: topN },
    content: {
      titulo: titulo ?? 'CONCENTRACIÓN DE CARTERA — TOP {n} CLIENTES VS. RESTO DE LA CARTERA',
      columnas: ['Cliente', 'Saldo', '% del total', '% acumulado'],
      filas: [
        ['ACME', 600, 60, 60],
        ['Resto (5)', 400, 40, 100],
      ],
      total: ['Total', 1000, 100, 100],
    },
  }
}

describe('DirectorioSeccion — concentración', () => {
  it('el título sigue al Top-N del mapeo en vez de quedar con un número guardado', () => {
    // Antes el número venía escrito en el título: cambiar el Top-N actualizaba las tarjetas y la
    // tabla, pero el encabezado seguía diciendo la cifra vieja.
    render(<DirectorioSeccion componente={concentracion({ topN: 5 })} />)
    expect(screen.getByText(/TOP 5 CLIENTES VS\. RESTO/)).toBeInTheDocument()
    expect(screen.queryByText(/\{n\}/)).not.toBeInTheDocument()
  })

  it('un título editado a mano, sin el marcador, se muestra tal cual', () => {
    render(<DirectorioSeccion componente={concentracion({ topN: 5, titulo: 'MIS CLIENTES CLAVE' })} />)
    expect(screen.getByText('MIS CLIENTES CLAVE')).toBeInTheDocument()
  })

  it('deriva las dos tarjetas resumen de las filas, no de un valor guardado', () => {
    const { container } = render(<DirectorioSeccion componente={concentracion({ topN: 1 })} />)
    // Se acota al bloque resumen: los mismos montos aparecen también en la tabla de abajo.
    const resumen = container.querySelector('.directorio-resumen')
    expect(resumen).toHaveTextContent('TOP 1 CLIENTES')
    expect(resumen).toHaveTextContent('$600')      // la única fila que no es el "Resto"
    expect(resumen).toHaveTextContent('RESTO (5)')
    expect(resumen).toHaveTextContent('$400')
  })
})

describe('DirectorioSeccion — antigüedad', () => {
  const componente = {
    config: { bloque: 'antiguedad' },
    mapeo: {},
    styles: { coloresPorCategoria: { Anticipada: '#2E7D32', '+120 días': '#C62828' } },
    content: {
      titulo: 'ANTIGÜEDAD DE CARTERA',
      categorias: ['Anticipada', '+120 días'],
      valores: [750000, 250000],
    },
  }

  it('calcula el porcentaje de cada barra a partir de los valores', () => {
    const { container } = render(<DirectorioSeccion componente={componente} />)
    // Recharts no dibuja bajo jsdom (mide ancho 0), así que se verifica el título, que sí sale.
    expect(screen.getByText('ANTIGÜEDAD DE CARTERA')).toBeInTheDocument()
    expect(container.querySelector('.directorio-seccion')).toBeInTheDocument()
  })
})

describe('DirectorioSeccion — cumplimiento', () => {
  it('arma la columna META desde el mapeo, no desde el contenido', () => {
    const componente = {
      config: { bloque: 'cumplimiento' },
      mapeo: { metas: [{ meta_min: 50 }, { meta_max: 5 }] },
      content: {
        titulo: 'CUMPLIMIENTO',
        filas: [
          ['Corriente', 600, 60, 'Cumple'],
          ['Más de 120 días', 100, 10, 'No cumple'],
        ],
      },
    }
    render(<DirectorioSeccion componente={componente} />)
    expect(screen.getByText('≥ 50%')).toBeInTheDocument()
    expect(screen.getByText('≤ 5%')).toBeInTheDocument()
    expect(screen.getByText('60% ✓')).toBeInTheDocument()
    expect(screen.getByText('10% ✗')).toBeInTheDocument()
  })
})

describe('DirectorioSeccion — KPIs', () => {
  // El KPI total es la base del porcentaje; los demás se leen contra él.
  const total = {
    config: { bloque: 'kpi', es_base_porcentaje: true },
    content: { titulo: 'CARTERA TOTAL', valor: 1000, fecha_corte: '2026-06-30' },
  }

  function masDe120(valor, { metaMaxima = 5 } = {}) {
    return {
      config: { bloque: 'kpi', es_base_porcentaje: false, tono: 'alerta', meta_maxima_porcentaje: metaMaxima },
      content: { titulo: 'VENCIDA +120 DÍAS', valor, descripcion: 'Suma de "Saldo" donde...' },
    }
  }

  it('el KPI total muestra el mes del corte, no la descripción del cálculo', () => {
    render(<DirectorioSeccion componente={total} componentes={[total]} />)
    expect(screen.getByText('Corte junio 2026')).toBeInTheDocument()
  })

  it('sin fecha de corte cae a la descripción, que es lo que había antes', () => {
    const sinFecha = { ...total, content: { ...total.content, fecha_corte: undefined, descripcion: 'Suma de "Saldo".' } }
    render(<DirectorioSeccion componente={sinFecha} componentes={[sinFecha]} />)
    expect(screen.getByText('Suma de "Saldo".')).toBeInTheDocument()
  })

  it('un KPI que excede su meta máxima lo dice, en vez de mostrar el porcentaje pelado', () => {
    const componente = masDe120(100)  // 10% de 1000, con meta máxima 5%
    render(<DirectorioSeccion componente={componente} componentes={[total, componente]} />)
    expect(screen.getByText('▲ 10% · excede meta máx. 5%')).toBeInTheDocument()
  })

  it('dentro de la meta vuelve al porcentaje simple: la alerta solo aparece cuando hay algo que señalar', () => {
    const componente = masDe120(30)  // 3% de 1000, por debajo del 5%
    render(<DirectorioSeccion componente={componente} componentes={[total, componente]} />)
    expect(screen.getByText('3% del portafolio')).toBeInTheDocument()
    expect(screen.queryByText(/excede meta/)).not.toBeInTheDocument()
  })

  it('justo en la meta no se considera excedida', () => {
    const componente = masDe120(50)  // exactamente 5%
    render(<DirectorioSeccion componente={componente} componentes={[total, componente]} />)
    expect(screen.getByText('5% del portafolio')).toBeInTheDocument()
  })

  it('un KPI sin meta declarada sigue mostrando el porcentaje, sin inventar una alerta', () => {
    const componente = {
      config: { bloque: 'kpi', es_base_porcentaje: false },
      content: { titulo: 'VENCIDA TOTAL', valor: 380 },
    }
    render(<DirectorioSeccion componente={componente} componentes={[total, componente]} />)
    expect(screen.getByText('38% del portafolio')).toBeInTheDocument()
  })
})

describe('DirectorioSeccion — título con el corte y hallazgos', () => {
  const total = {
    config: { bloque: 'kpi', es_base_porcentaje: true },
    content: { titulo: 'CARTERA TOTAL', valor: 1000, fecha_corte: '2026-06-30' },
  }

  function antiguedad({ titulo = 'ANTIGÜEDAD DE CARTERA — {corte}' } = {}) {
    return {
      config: { bloque: 'antiguedad' },
      content: {
        titulo,
        descripcion: 'Antigüedad de "Saldo" según "Fecha de Vencimiento".',
        categorias: ['Anticipada', '+120 días'],
        valores: [800, 200],
      },
    }
  }

  it('el título toma el mes del corte del KPI total, sin repetir el dato en cada sección', () => {
    render(<DirectorioSeccion componente={antiguedad()} componentes={[total, antiguedad()]} />)
    expect(screen.getByText('ANTIGÜEDAD DE CARTERA — JUNIO 2026')).toBeInTheDocument()
  })

  it('sin corte conocido el marcador se quita junto al guion, en vez de mostrarse crudo', () => {
    render(<DirectorioSeccion componente={antiguedad()} componentes={[antiguedad()]} />)
    expect(screen.getByText('ANTIGÜEDAD DE CARTERA')).toBeInTheDocument()
    expect(screen.queryByText(/\{corte\}/)).not.toBeInTheDocument()
  })

  it('un título editado sin el marcador manda: no se le agrega el corte', () => {
    const propio = antiguedad({ titulo: 'MI TÍTULO' })
    render(<DirectorioSeccion componente={propio} componentes={[total, propio]} />)
    expect(screen.getByText('MI TÍTULO')).toBeInTheDocument()
  })

  it('el hallazgo de la IA reemplaza a la descripción del cálculo', () => {
    render(
      <DirectorioSeccion
        componente={antiguedad()}
        componentes={[total, antiguedad()]}
        hallazgoIA="El 80% de la cartera está al corriente."
      />,
    )
    expect(screen.getByText(/El 80% de la cartera está al corriente/)).toBeInTheDocument()
    expect(screen.queryByText(/según "Fecha de Vencimiento"/)).not.toBeInTheDocument()
  })

  it('sin hallazgo de IA cae a la descripción, para no dejar la sección con un hueco', () => {
    render(<DirectorioSeccion componente={antiguedad()} componentes={[total, antiguedad()]} />)
    expect(screen.getByText(/según "Fecha de Vencimiento"/)).toBeInTheDocument()
  })

  /**
   * El prompt le pide a la IA que resalte los números y nombres entre `**dobles asteriscos**`
   * (`dashboard_interpretation.py::_construir_prompt_hallazgos`). Las secciones que muestran el
   * hallazgo como nota al pie —cumplimiento de metas y mayores deudores— lo imprimían crudo: en
   * producción se leía "El **cumplimiento de metas** evidencia…" con los asteriscos a la vista.
   */
  it('las negritas del hallazgo se interpretan también en la nota al pie', () => {
    // La sección de deudores muestra su hallazgo como nota al pie y no en la caja destacada: es
    // el camino que imprimía los asteriscos crudos.
    const deudores = {
      config: { bloque: 'deudores' },
      mapeo: { cuantos: 2 },
      content: {
        titulo: 'MAYORES DEUDORES',
        deudores: [{ nombre: 'ACME', total: 500, porcentaje_cartera: 50, tramos: [] }],
      },
    }

    render(
      <DirectorioSeccion
        componente={deudores}
        componentes={[deudores]}
        hallazgoIA="El tramo **+120 días** concentra **$364,164**."
      />,
    )

    expect(screen.getByText('+120 días').tagName).toBe('STRONG')
    expect(screen.getByText('$364,164').tagName).toBe('STRONG')
    expect(document.body.textContent).not.toContain('**')
  })
})

describe('DirectorioSeccion — nomenclatura del informe', () => {
  const total = {
    config: { bloque: 'kpi', es_base_porcentaje: true },
    content: { titulo: 'CARTERA TOTAL', valor: 1000, fecha_corte: '2026-06-30' },
  }

  function concentracionConResto(columnaId = 'Cliente') {
    return {
      config: { bloque: 'concentracion' },
      mapeo: { top_n: 2, columna_id: columnaId },
      content: {
        titulo: 'CONCENTRACIÓN — TOP {n}',
        columnas: ['Cliente', 'Saldo', '% del total', '% acumulado'],
        filas: [
          ['ACME', 600, 60, 60],
          ['OTRA', 200, 20, 80],
          ['Resto (1130)', 200, 20, 100],
        ],
        total: ['Total', 1000, 100, 100],
      },
    }
  }

  it('la fila del resto dice de qué son esos N, con separador de miles', () => {
    render(<DirectorioSeccion componente={concentracionConResto()} />)
    // Aparece dos veces: en la tarjeta resumen (en mayúsculas) y en la fila de la tabla.
    expect(screen.getByText('Resto (1,130 clientes)')).toBeInTheDocument()
    expect(screen.getByText('RESTO (1,130 CLIENTES)')).toBeInTheDocument()
  })

  it('el plural sale de la columna de identidad, no está escrito a mano', () => {
    render(<DirectorioSeccion componente={concentracionConResto('Ciudad')} />)
    expect(screen.getByText('Resto (1,130 ciudades)')).toBeInTheDocument()
  })

  it('la fila de cierre se llama TOTAL CARTERA, como en el informe', () => {
    render(<DirectorioSeccion componente={concentracionConResto()} />)
    expect(screen.getByText('TOTAL CARTERA')).toBeInTheDocument()
  })

  it('los encabezados de porcentaje dicen qué miden', () => {
    render(<DirectorioSeccion componente={concentracionConResto()} />)
    // El texto va en minúsculas; las mayúsculas las pone el CSS (revisión final UX/UI).
    expect(screen.getByRole('columnheader', { name: '% sobre total' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '% acumulado (calculado)' })).toBeInTheDocument()
  })

  it('los dos primeros encabezados siguen a las columnas elegidas, que son parametrizables', () => {
    const componente = concentracionConResto()
    componente.content.columnas = ['Recuperador', 'Importe', 'x', 'y']
    render(<DirectorioSeccion componente={componente} />)
    expect(screen.getByRole('columnheader', { name: 'Recuperador' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Importe' })).toBeInTheDocument()
  })

  it('el título de deudores toma la cantidad del mapeo y el mes del corte', () => {
    const deudores = {
      config: { bloque: 'deudores' },
      mapeo: { cuantos: 2 },
      content: {
        titulo: 'ANTIGÜEDAD DE CARTERA — {n} MAYORES DEUDORES ({corte})',
        deudores: [{ nombre: 'ACME', total: 500, porcentaje_cartera: 50, tramos: [] }],
      },
    }
    render(<DirectorioSeccion componente={deudores} componentes={[total, deudores]} />)
    expect(screen.getByText('ANTIGÜEDAD DE CARTERA — 2 MAYORES DEUDORES (JUNIO 2026)')).toBeInTheDocument()
  })

  it('sin corte, el paréntesis del marcador no queda vacío colgando', () => {
    const deudores = {
      config: { bloque: 'deudores' },
      mapeo: { cuantos: 3 },
      content: {
        titulo: 'ANTIGÜEDAD DE CARTERA — {n} MAYORES DEUDORES ({corte})',
        deudores: [{ nombre: 'ACME', total: 500, porcentaje_cartera: 50, tramos: [] }],
      },
    }
    render(<DirectorioSeccion componente={deudores} componentes={[deudores]} />)
    expect(screen.getByText('ANTIGÜEDAD DE CARTERA — 3 MAYORES DEUDORES')).toBeInTheDocument()
  })
})

describe('DirectorioSeccion — bordes', () => {
  it('un bloque desconocido no dibuja nada en vez de romper la pantalla', () => {
    const { container } = render(
      <DirectorioSeccion componente={{ config: { bloque: 'inventado' }, content: { titulo: 'x' } }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('un componente sin contenido todavía calculado no dibuja nada', () => {
    const { container } = render(
      <DirectorioSeccion componente={{ config: { bloque: 'concentracion' } }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
