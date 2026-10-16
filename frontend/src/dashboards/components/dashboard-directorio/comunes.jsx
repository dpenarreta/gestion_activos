/**
 * Bloques de texto compartidos por las secciones del Dashboard Directorio.
 *
 * Solo componentes: el formato de números vive en `formato.js` (ver el motivo allí).
 */

/** Interpreta los `**dobles asteriscos**` como negrita, igual criterio que `HallazgosClaveCard`. */
function conNegritas(texto) {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) => (
    parte.startsWith('**') && parte.endsWith('**')
      // eslint-disable-next-line react/no-array-index-key -- el índice ES la identidad del fragmento
      ? <strong key={i}>{parte.slice(2, -2)}</strong>
      // eslint-disable-next-line react/no-array-index-key -- ídem
      : <span key={i}>{parte}</span>
  ))
}

/** El bloque "HALLAZGOS CLAVE": aviso informativo con la forma de `mz-alert--info` de la Matriz. */
export function HallazgosClave({ texto }) {
  if (!texto) return null
  return (
    <div className="directorio-hallazgos">
      <div className="directorio-hallazgos__titulo">
        <i className="bi bi-lightbulb" aria-hidden="true"></i> HALLAZGOS CLAVE
      </div>
      <p className="directorio-hallazgos__texto">{conNegritas(texto)}</p>
    </div>
  )
}

/** Las notas al pie en cursiva que el informe pone bajo varias secciones.
 *
 * Interpreta las negritas por el mismo motivo que `HallazgosClave`: bajo dos de las secciones, lo
 * que se muestra acá es el hallazgo redactado por la IA, y el prompt le pide expresamente que
 * resalte los números y nombres entre `**dobles asteriscos**`. Sin esto, en pantalla se leía
 * "El **cumplimiento de metas** evidencia…" con los asteriscos crudos. Un texto sin marcas —la
 * descripción calculada, que es el otro origen posible— pasa igual. */
export function Nota({ texto }) {
  if (!texto) return null
  return <p className="directorio-nota">{conNegritas(texto)}</p>
}

export function TituloSeccion({ children }) {
  return <div className="directorio-seccion__titulo">{children}</div>
}
