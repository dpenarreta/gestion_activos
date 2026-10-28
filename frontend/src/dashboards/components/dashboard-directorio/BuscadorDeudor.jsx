import { useEffect, useRef, useState } from 'react'
import { buscarDeudores, obtenerDetalleDeudor } from '../../services/dashboardLayoutService'
import { TituloSeccion } from './comunes'
import { moneda, porcentaje } from './formato'

/**
 * Consulta puntual de un deudor: antigüedad a la izquierda, sus documentos a la derecha.
 *
 * Las otras secciones del informe muestran a los clientes más grandes; ninguna deja preguntar por
 * uno en particular. Acá se escribe un nombre o un identificador, se elige entre las coincidencias
 * y se ven sus seis tramos más las filas del archivo donde aparece.
 *
 * Por qué se elige entre coincidencias en vez de sumarlas: un texto corto ("transex") puede tocar
 * dos razones sociales distintas, y sumarlas daría un total que no le corresponde a ninguna. El
 * backend devuelve las coincidencias con su saldo justamente para poder distinguirlas antes.
 *
 * Qué columnas trae el detalle lo decide `config.columnas_detalle` del componente —o sea, quien
 * arma el dashboard— y no cada usuario: es parte de la configuración que se guarda y se ve igual
 * para todos.
 *
 * Mientras se escribe se piden SUGERENCIAS al mismo endpoint de búsqueda, con una espera de
 * `ESPERA_SUGERENCIAS` desde la última tecla. Esa espera no es cosmética: cada consulta lee el
 * archivo de la carga, y aunque ahora está cacheado en el servidor
 * (`services/consulta_deudor.py`), disparar una petición por pulsación igual manda ráfagas de
 * peticiones que llegan desordenadas. Por eso además se descarta toda respuesta que no sea la del
 * texto que está escrito en ese momento: sin eso, la respuesta lenta de "cor" puede pisar a la de
 * "corporacion" y mostrar sugerencias que no corresponden a lo que se ve en el campo.
 */

/**
 * El aviso de identidad dudosa, en palabras, o `null` si no hay nada que advertir.
 *
 * Son dos señales distintas y conviene no mezclarlas: que el NOMBRE aparezca con varios
 * identificadores (dos empresas homónimas, o el mismo cliente cargado dos veces) y que el
 * IDENTIFICADOR aparezca con varios nombres (el saldo se suma bien, pero la razón social que se
 * muestra depende de qué fila venga primero).
 */
function avisoDeIdentidad({ otros_identificadores: identificadores, otros_nombres: nombres }) {
  const partes = []
  if (identificadores?.length) {
    partes.push(`este nombre también figura con ${identificadores.length === 1 ? 'el identificador' : 'los identificadores'} ${identificadores.join(', ')}`)
  }
  if (nombres?.length) {
    partes.push(`este identificador también figura con ${nombres.length === 1 ? 'el nombre' : 'los nombres'} ${nombres.join(', ')}`)
  }
  if (!partes.length) return null
  // Se arma con mayúscula inicial y punto final acá, y no en cada lugar que lo muestra.
  const texto = partes.join('; ')
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}.`
}

/** Milisegundos desde la última tecla antes de pedir sugerencias. */
const ESPERA_SUGERENCIAS = 300
/** Mínimo de caracteres para sugerir (el backend rechaza menos de dos). */
const MINIMO_PARA_SUGERIR = 2
/** Cuántas sugerencias se listan; el resto se resume en una línea al pie. */
const MAXIMO_SUGERENCIAS = 8
export default function BuscadorDeudor({ componente, dashboardId }) {
  const { content, mapeo, config } = componente
  const [texto, setTexto] = useState('')
  const [coincidencias, setCoincidencias] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [sugerencias, setSugerencias] = useState(null)
  const [totalSugerencias, setTotalSugerencias] = useState(0)
  const [resaltada, setResaltada] = useState(-1)
  // Tras elegir una sugerencia el campo queda con ese nombre exacto; sin esta marca, ese mismo
  // texto dispararía una consulta nueva y la lista volvería a abrirse sobre el resultado.
  const sugerirDesactivado = useRef(false)

  // El dashboard llega por prop desde la página (que lo tiene de la ruta) y no desde `config`:
  // es una propiedad de DÓNDE está montado el componente, no de cómo está configurado, y meterlo
  // en la configuración guardada lo dejaría apuntando al dashboard equivocado si alguien
  // duplicara el componente en otro.
  const columnas = {
    nombre: mapeo?.columna_id,
    ruc: mapeo?.columna_ruc,
    fecha: mapeo?.columna_fecha,
    valor: mapeo?.columna_valor,
  }
  // El campo solo ofrece buscar por identificador si el dashboard tiene una columna que lo
  // contenga. Prometerlo igual —como hacía el texto fijo "Nombre o identificador"— deja a quien
  // pega un RUC creyendo que el buscador falla, cuando lo que pasa es que ese dato no está en el
  // archivo. Se configura en "Configurar componente → Identificador del cliente".
  const etiquetaBusqueda = columnas.ruc
    ? 'Nombre o identificador del cliente'
    : 'Nombre del cliente'

  // Sugerencias mientras se escribe. El efecto se vuelve a montar con cada tecla, así que el
  // `clearTimeout` de la limpieza es lo que hace el "esperar a que deje de escribir".
  useEffect(() => {
    const consulta = texto.trim()
    if (sugerirDesactivado.current || consulta.length < MINIMO_PARA_SUGERIR) {
      setSugerencias(null)
      return undefined
    }
    let vigente = true
    const temporizador = setTimeout(() => {
      buscarDeudores(dashboardId, { texto: consulta, columnas })
        .then((datos) => {
          if (!vigente) return
          setSugerencias(datos.coincidencias)
          setTotalSugerencias(datos.total)
          setResaltada(-1)
        })
        // Un fallo sugiriendo no se le muestra a nadie: la persona no pidió esto, está
        // escribiendo. El error sí aparece si después pulsa "Consultar".
        .catch(() => { if (vigente) setSugerencias(null) })
    }, ESPERA_SUGERENCIAS)
    return () => { vigente = false; clearTimeout(temporizador) }
    // `columnas` se rearma en cada render (es un objeto literal); depender de él re-dispararía
    // el efecto sin que haya cambiado nada. Lo que importa es el texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, dashboardId])

  function escribir(valor) {
    sugerirDesactivado.current = false
    setTexto(valor)
  }

  function elegirSugerencia(sugerencia) {
    sugerirDesactivado.current = true
    setTexto(sugerencia.nombre)
    setSugerencias(null)
    setResaltada(-1)
    // Se guarda como "la única coincidencia" para que el detalle no ofrezca "elegir otro": la
    // elección ya se hizo acá.
    setCoincidencias([sugerencia])
    elegir(sugerencia.identidad)
  }

  function teclear(evento) {
    const visibles = (sugerencias || []).slice(0, MAXIMO_SUGERENCIAS)
    if (!visibles.length) return
    if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      setResaltada((i) => (i + 1) % visibles.length)
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      setResaltada((i) => (i <= 0 ? visibles.length - 1 : i - 1))
    } else if (evento.key === 'Enter' && resaltada >= 0) {
      // Solo intercepta el Enter cuando hay una sugerencia resaltada; si no, deja que el
      // formulario haga la búsqueda de siempre.
      evento.preventDefault()
      elegirSugerencia(visibles[resaltada])
    } else if (evento.key === 'Escape') {
      setSugerencias(null)
      setResaltada(-1)
    }
  }

  function buscar(evento) {
    evento?.preventDefault()
    if (!texto.trim()) return
    setCargando(true)
    setError('')
    setDetalle(null)
    setSugerencias(null)
    buscarDeudores(dashboardId, { texto: texto.trim(), columnas })
      .then((datos) => {
        setCoincidencias(datos.coincidencias)
        // Con una sola coincidencia, elegirla a mano es un clic sin decisión: se abre directo.
        if (datos.coincidencias.length === 1) elegir(datos.coincidencias[0].identidad)
      })
      .catch((e) => setError(e.response?.data?.mensaje || 'No se pudo completar la búsqueda.'))
      .finally(() => setCargando(false))
  }

  function elegir(identidad) {
    setCargando(true)
    setError('')
    obtenerDetalleDeudor(dashboardId, {
      identidad, columnas, columnasDetalle: config?.columnas_detalle,
    })
      .then(setDetalle)
      .catch((e) => setError(e.response?.data?.mensaje || 'No se pudo traer el detalle.'))
      .finally(() => setCargando(false))
  }

  return (
    <div className="chart-panel directorio-seccion">
      <TituloSeccion>{content?.titulo || 'CONSULTA POR CLIENTE'}</TituloSeccion>

      <form className="directorio-buscador" onSubmit={buscar} autoComplete="off">
        <div className="directorio-buscador__campo">
          <input
            type="search"
            className="form-control"
            placeholder={etiquetaBusqueda}
            value={texto}
            onChange={(e) => escribir(e.target.value)}
            onKeyDown={teclear}
            // El cierre va en `onBlur` y la elección en `onMouseDown`, que ocurre ANTES: con
            // `onClick` la lista ya se habría cerrado y el clic caería en el vacío.
            onBlur={() => { setSugerencias(null); setResaltada(-1) }}
            aria-label={etiquetaBusqueda}
            role="combobox"
            aria-expanded={Boolean(sugerencias?.length)}
            aria-controls="sugerencias-deudor"
            aria-autocomplete="list"
            aria-activedescendant={resaltada >= 0 ? `sugerencia-deudor-${resaltada}` : undefined}
          />
          {Boolean(sugerencias?.length) && (
            <ul className="directorio-sugerencias" id="sugerencias-deudor" role="listbox">
              {sugerencias.slice(0, MAXIMO_SUGERENCIAS).map((sugerencia, i) => (
                <li
                  key={sugerencia.identidad}
                  id={`sugerencia-deudor-${i}`}
                  role="option"
                  aria-selected={i === resaltada}
                  className={`directorio-sugerencia${i === resaltada ? ' directorio-sugerencia--activa' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); elegirSugerencia(sugerencia) }}
                  onMouseEnter={() => setResaltada(i)}
                >
                  <span className="directorio-sugerencia__nombre">
                    {sugerencia.nombre}
                    {/* Con el nombre repartido en varios identificadores, mostrarlo es lo único
                        que distingue una fila de la otra: sin esto son idénticas. */}
                    {Boolean(sugerencia.otros_identificadores?.length) && (
                      <span className="directorio-sugerencia__id"> · {sugerencia.identidad}</span>
                    )}
                  </span>
                  {Boolean(avisoDeIdentidad(sugerencia)) && (
                    <span className="directorio-sugerencia__alerta" title={avisoDeIdentidad(sugerencia)}>
                      <i className="bi bi-exclamation-triangle" aria-hidden="true"></i>
                    </span>
                  )}
                  <span className="directorio-sugerencia__saldo">{moneda(sugerencia.saldo)}</span>
                </li>
              ))}
              {totalSugerencias > MAXIMO_SUGERENCIAS && (
                <li className="directorio-sugerencias__resto" role="presentation">
                  y {totalSugerencias - MAXIMO_SUGERENCIAS} más — siga escribiendo para afinar
                </li>
              )}
            </ul>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={cargando || !texto.trim()}>
          {cargando ? 'Consultando…' : 'Consultar'}
        </button>
      </form>

      {error && <div className="alert alert-warning py-2 mb-3">{error}</div>}

      {/* La lista solo aparece cuando hay algo que decidir: con una coincidencia se abrió sola. */}
      {coincidencias && coincidencias.length > 1 && !detalle && (
        <div className="directorio-coincidencias">
          <div className="directorio-coincidencias__titulo">
            {coincidencias.length} coincidencias — elija una:
          </div>
          {coincidencias.map((c) => (
            <button key={c.identidad} type="button" className="directorio-coincidencia" onClick={() => elegir(c.identidad)}>
              <span className="directorio-coincidencia__nombre">{c.nombre}</span>
              <span className="directorio-coincidencia__id">{c.identidad}</span>
              <span className="directorio-coincidencia__saldo">{moneda(c.saldo)}</span>
              <span className="directorio-coincidencia__filas">{c.filas} fila{c.filas === 1 ? '' : 's'}</span>
              {Boolean(avisoDeIdentidad(c)) && (
                <span className="directorio-coincidencia__alerta">
                  <i className="bi bi-exclamation-triangle" aria-hidden="true"></i> {avisoDeIdentidad(c)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {coincidencias && coincidencias.length === 0 && !cargando && (
        <p className="text-muted mb-0">No hay clientes que coincidan con «{texto}».</p>
      )}

      {detalle && <ResultadoDeudor detalle={detalle} onVolver={() => setDetalle(null)}
                                   hayVarias={(coincidencias?.length || 0) > 1} />}
    </div>
  )
}

function ResultadoDeudor({ detalle, onVolver, hayVarias }) {
  const { tramos, filas, columnas } = detalle
  const total = detalle.total || 0
  const aviso = avisoDeIdentidad(detalle)

  return (
    <div className="directorio-deudor-consulta">
      <div className="directorio-deudor-consulta__encabezado">
        <div className="directorio-deudor__titulo">
          {detalle.nombre} — {moneda(total)} · {detalle.cantidad_filas} documento
          {detalle.cantidad_filas === 1 ? '' : 's'}
        </div>
        {hayVarias && (
          <button type="button" className="btn btn-link btn-sm p-0" onClick={onVolver}>
            ← Elegir otro cliente
          </button>
        )}
      </div>

      {Boolean(aviso) && (
        <div className="mz-alert mz-alert--warn directorio-deudor-consulta__alerta">
          <i className="bi bi-exclamation-triangle" aria-hidden="true"></i>
          <span>
          <strong>Revise la identidad de este cliente.</strong> {aviso}{' '}
          Los totales de acá abajo son solo de <em>{detalle.identidad}</em>.
          </span>
        </div>
      )}

      <div className="directorio-deudor-consulta__cuerpo">
        <div className="directorio-deudor-consulta__antiguedad">
          <div className="directorio-tabla-ancho">
          <table className="directorio-tabla directorio-tabla--compacta">
            <thead>
              <tr>
                <th>TRAMO</th>
                <th className="text-end">SALDO</th>
                <th className="text-end">%</th>
              </tr>
            </thead>
            <tbody>
              {(tramos?.categorias || []).map((categoria, i) => {
                const valor = tramos.valores[i] ?? 0
                return (
                  <tr key={categoria}>
                    <td>{categoria}</td>
                    <td className="text-end">{moneda(valor)}</td>
                    {/* Un tramo sin filas muestra 0, no se oculta: que esté vacío es información. */}
                    <td className="text-end">{porcentaje(total ? (valor / total) * 100 : 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>

        <div className="directorio-deudor-consulta__detalle">
          <div className="directorio-tabla-scroll">
            <table className="directorio-tabla directorio-tabla--compacta">
              <thead>
                <tr>
                  {columnas.map((columna) => (
                    <th key={columna}>{String(columna).toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((fila, i) => (
                  // eslint-disable-next-line react/no-array-index-key -- dos documentos pueden ser idénticos
                  <tr key={i}>
                    {fila.map((valor, j) => (
                      // eslint-disable-next-line react/no-array-index-key -- la columna puede repetirse
                      <td key={j}>{valor === null || valor === undefined ? '—' : String(valor)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
