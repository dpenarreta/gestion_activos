import { useEffect, useState } from 'react'
import { Table, Form } from 'react-bootstrap'

/** Celda editable: mientras se teclea el valor mostrado vive en estado local (para no pelear con
 * parseo de números a mitad de tecleo, mismo patrón que `CampoColor`) y el commit real pasa recién
 * en `onBlur`. Si el valor ORIGINAL de la celda era `number`, exige que el nuevo texto parsee a un
 * número válido — si no, no propaga y muestra un error puntual sin perder lo tecleado. Si el
 * original era `string`/`null`, el nuevo valor se propaga tal cual, como texto. */
function CeldaEditable({ valor, esNumerica, onCambiar, ariaLabel }) {
  const [texto, setTexto] = useState(String(valor ?? ''))
  const [errorLocal, setErrorLocal] = useState('')

  useEffect(() => setTexto(String(valor ?? '')), [valor])

  const confirmar = () => {
    if (!esNumerica) {
      setErrorLocal('')
      if (texto !== (valor ?? '')) onCambiar(texto)
      return
    }
    const numero = Number(texto)
    if (texto.trim() === '' || Number.isNaN(numero)) {
      setErrorLocal('Debe ser un número.')
      return
    }
    setErrorLocal('')
    if (numero !== valor) onCambiar(numero)
  }

  return (
    <td>
      <Form.Control
        size="sm"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        isInvalid={Boolean(errorLocal)}
        aria-label={ariaLabel}
      />
      {errorLocal && <div className="text-danger" style={{ fontSize: '0.75rem' }}>{errorLocal}</div>}
    </td>
  )
}

/** Editor de valores de celda para tablas de Zona Personal (`content.columnas`/`filas`/`total`,
 * forma "multi-columna" de `generic_charts.py::generar_datos_tabla`) — deliberadamente solo deja
 * cambiar el VALOR de una celda que ya existe, nunca agregar/quitar filas ni columnas (esa
 * restricción real la impone el backend, `_validar_contenido_tabla`; acá simplemente no hay
 * controles para eso). Misma iteración posicional que `GenericDataTable.jsx::TablaMultiColumna`
 * para que el editor se vea como la tabla real. */
export default function TableCellsEditor({ columnas, filas, total, onCambiarFilas, onCambiarTotal }) {
  if (!Array.isArray(columnas) || !Array.isArray(filas)) return null

  const cambiarCelda = (indiceFila, indiceColumna, nuevoValor) => {
    const nuevasFilas = filas.map((fila, i) => (i === indiceFila ? fila.map((v, j) => (j === indiceColumna ? nuevoValor : v)) : fila))
    onCambiarFilas(nuevasFilas)
  }

  const cambiarCeldaTotal = (indiceColumna, nuevoValor) => {
    onCambiarTotal(total.map((v, j) => (j === indiceColumna ? nuevoValor : v)))
  }

  return (
    <Table responsive size="sm" className="mb-0">
      <thead>
        <tr>
          {columnas.map((c, i) => (
            // eslint-disable-next-line react/no-array-index-key -- el nombre de columna no es único
            <th key={i}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((fila, i) => (
          // eslint-disable-next-line react/no-array-index-key -- las filas no tienen un id propio
          <tr key={i}>
            {fila.map((valor, j) => (
              <CeldaEditable
                // eslint-disable-next-line react/no-array-index-key -- ídem, el nombre de columna puede repetirse
                key={j}
                valor={valor}
                esNumerica={typeof valor === 'number'}
                onCambiar={(nuevo) => cambiarCelda(i, j, nuevo)}
                ariaLabel={`${columnas[j]} — fila ${i + 1}`}
              />
            ))}
          </tr>
        ))}
      </tbody>
      {Array.isArray(total) && (
        <tfoot>
          <tr className="fw-bold">
            {total.map((valor, j) => (
              <CeldaEditable
                // eslint-disable-next-line react/no-array-index-key -- ídem
                key={j}
                valor={valor}
                esNumerica={typeof valor === 'number'}
                onCambiar={(nuevo) => cambiarCeldaTotal(j, nuevo)}
                ariaLabel={`${columnas[j]} — total`}
              />
            ))}
          </tr>
        </tfoot>
      )}
    </Table>
  )
}
