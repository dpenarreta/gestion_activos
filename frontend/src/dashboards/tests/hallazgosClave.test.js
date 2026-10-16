import { describe, expect, it } from 'vitest'
import { generarHallazgos } from '../utils/hallazgosClave'

describe('generarHallazgos', () => {
  describe('kpi', () => {
    it('sin tendencia, solo menciona el valor actual', () => {
      const texto = generarHallazgos('kpi', { datos: { valor: 12458, formato: 'numero' } })
      expect(texto).toBe('El valor actual es **12.458**.')
    })

    it('con tendencia, agrega una frase sobre el aumento/disminución', () => {
      const texto = generarHallazgos('kpi', {
        datos: { valor: 100, formato: 'numero', tendencia: { valor: 8.5, texto: 'vs. mes anterior' } },
      })
      expect(texto).toMatch(/aumento del \*\*8,5.*%\*\* vs\. mes anterior/)
    })

    it('tendencia negativa se describe como disminución', () => {
      const texto = generarHallazgos('kpi', {
        datos: { valor: 100, formato: 'numero', tendencia: { valor: -3.2, texto: 'vs. mes anterior' } },
      })
      expect(texto).toMatch(/disminución del \*\*3,2.*%\*\*/)
    })

    it('sin datos, no hay hallazgos', () => {
      expect(generarHallazgos('kpi', { datos: null })).toBe('')
    })

    it('con meta cumplida, agrega una frase de "Cumple"', () => {
      const texto = generarHallazgos('kpi', {
        datos: { valor: 100, formato: 'numero', meta: { meta_min: 50, meta_max: 200, cumple: true, motivos: [] } },
      })
      expect(texto).toMatch(/\*\*Cumple\*\* la meta configurada\./)
    })

    it('con meta incumplida, agrega una frase de "No cumple" con los motivos', () => {
      const texto = generarHallazgos('kpi', {
        datos: {
          valor: 10, formato: 'numero',
          meta: { meta_min: 50, meta_max: null, cumple: false, motivos: ['menor al mínimo (50)'] },
        },
      })
      expect(texto).toMatch(/\*\*No cumple\*\* la meta configurada \(menor al mínimo \(50\)\)\./)
    })

    it('sin meta, no menciona ningún cumplimiento', () => {
      const texto = generarHallazgos('kpi', { datos: { valor: 100, formato: 'numero' } })
      expect(texto).not.toMatch(/meta configurada/)
    })
  })

  describe('categorico (barras/líneas/pastel)', () => {
    it('identifica la categoría de mayor y menor valor, y el total, en un solo párrafo', () => {
      const texto = generarHallazgos('categorico', {
        datos: { categorias: ['A', 'B', 'C'], valores: [50, 100, 20] },
      })
      expect(texto).toContain('Hay 3 categorías, con un total de **170**.')
      expect(texto).toMatch(/\*\*B\*\* tiene el mayor valor \(100/)
      expect(texto).toMatch(/\*\*C\*\* tiene el menor valor \(20\)/)
    })

    it('con una sola categoría, no repite la misma como "mayor" y "menor"', () => {
      const texto = generarHallazgos('categorico', { datos: { categorias: ['A'], valores: [10] } })
      expect(texto.match(/\*\*A\*\*/g)).toHaveLength(1)
    })

    it('sin categorías, no hay hallazgos', () => {
      expect(generarHallazgos('categorico', { datos: { categorias: [], valores: [] } })).toBe('')
    })

    it('con 3 o más categorías, agrega la concentración de las 3 principales', () => {
      const texto = generarHallazgos('categorico', {
        datos: { categorias: ['A', 'B', 'C', 'D'], valores: [40, 30, 20, 10] },
      })
      expect(texto).toContain('3 categorías principales concentran')
    })

    it('no asume que la última categoría es la de menor valor (caso "Otras" con valor alto al final)', () => {
      const texto = generarHallazgos('categorico', {
        datos: { categorias: ['A', 'B', 'Otras'], valores: [100, 5, 80] },
      })
      expect(texto).toMatch(/\*\*A\*\* tiene el mayor valor/)
      expect(texto).toMatch(/\*\*B\*\* tiene el menor valor \(5\)/)
    })
  })

  describe('multiserie (agrupadas/apiladas/área/líneas múltiples)', () => {
    it('identifica la serie y la categoría con mayor valor acumulado', () => {
      const texto = generarHallazgos('multiserie', {
        datosMultiserie: {
          categorias: ['Ene', 'Feb'],
          series: [{ nombre: 'Ingresos', valores: [100, 200] }, { nombre: 'Gastos', valores: [50, 60] }],
        },
      })
      expect(texto).toContain('Se comparan **2** series a lo largo de **2** categorías.')
      expect(texto).toMatch(/\*\*Ingresos\*\* es la serie con mayor valor acumulado \(300/)
      expect(texto).toMatch(/\*\*Feb\*\* es la categoría con mayor valor combinado/)
    })

    it('sin series, no hay hallazgos', () => {
      expect(generarHallazgos('multiserie', { datosMultiserie: { categorias: ['A'], series: [] } })).toBe('')
    })
  })

  describe('dispersion', () => {
    it('detecta una correlación positiva fuerte', () => {
      const puntos = Array.from({ length: 10 }, (_, i) => ({ x: i, y: i * 2 }))
      const texto = generarHallazgos('dispersion', { datos: { puntos } })
      expect(texto).toMatch(/relación positiva fuerte/)
    })

    it('detecta una correlación negativa', () => {
      const puntos = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 100 - i * 3 }))
      const texto = generarHallazgos('dispersion', { datos: { puntos } })
      expect(texto).toMatch(/relación negativa/)
    })

    it('sin puntos, no hay hallazgos', () => {
      expect(generarHallazgos('dispersion', { datos: { puntos: [] } })).toBe('')
    })
  })

  describe('tabla', () => {
    it('multi-columna: identifica filas/columnas, la de mayor valor y los totales', () => {
      const texto = generarHallazgos('tabla', {
        datos: {
          columnas: ['Producto', 'Ventas'],
          filas: [['A', 50], ['B', 100]],
          total: ['Total', 150],
        },
      })
      expect(texto).toContain('La tabla tiene **2** filas y **2** columnas.')
      expect(texto).toMatch(/\*\*B\*\* tiene el mayor valor de "Ventas" \(\*\*100\*\*\)/)
      expect(texto).toMatch(/En total: Ventas = 150/)
    })

    it('forma simple (categorias/valores): reutiliza los mismos hallazgos que "categorico"', () => {
      const texto = generarHallazgos('tabla', { datos: { categorias: ['A', 'B'], valores: [10, 20] } })
      expect(texto).toContain('Hay 2 categorías, con un total de **30**.')
    })

    it('sin filas, no hay hallazgos', () => {
      expect(generarHallazgos('tabla', { datos: { columnas: ['A'], filas: [] } })).toBe('')
    })

    it('cumplimiento_metas: ninguna fila se excluye por nombre, "mayor valor" es la de mayor % acumulado real', () => {
      const texto = generarHallazgos('tabla', {
        datos: {
          columnas: ['Tramo', 'Saldo', '% acumulado', 'Resultado'],
          filas: [
            ['Corriente', 100, 10, 'Cumple'],
            ['Vencido ≤ 30 días (acum.)', 300, 30, 'Sin meta'],
            ['Más de 120 días', 1000, 100, 'Sin meta'],
          ],
          total: null,
        },
      })
      expect(texto).toMatch(/\*\*Más de 120 días\*\* tiene el mayor valor de "Saldo" \(\*\*1\.000\*\*\)/)
    })

    it('con una columna de texto (no numérica) antes de las de valor, no la usa para "mayor valor"', () => {
      const texto = generarHallazgos('tabla', {
        datos: {
          columnas: ['Producto', 'Categoría', 'Ventas'],
          filas: [['Producto A', 'Electrónica', 245000], ['Producto B', 'Hogar', 180000]],
          total: ['Total', '', 425000],
        },
      })
      expect(texto).toMatch(/\*\*Producto A\*\* tiene el mayor valor de "Ventas" \(\*\*245\.000\*\*\)/)
      expect(texto).not.toContain('mayor valor de "Categoría"')
      expect(texto).toContain('En total: Ventas = 425.000.')
      expect(texto).not.toContain('Categoría =')
    })
  })

  it('una variante desconocida no devuelve hallazgos', () => {
    expect(generarHallazgos('no-existe', { datos: { valor: 1 } })).toBe('')
  })
})
