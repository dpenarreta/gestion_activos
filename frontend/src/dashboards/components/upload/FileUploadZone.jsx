import { useCallback, useRef, useState } from 'react'
import { Alert, Button, Spinner } from 'react-bootstrap'
import { formatNumber } from '../../utils/format'

const EXTENSIONES_PERMITIDAS = ['.xlsx', '.xls']
const TAMANO_MAXIMO_BYTES = 25 * 1024 * 1024

function extensionValida(nombre) {
  const n = nombre.toLowerCase()
  return EXTENSIONES_PERMITIDAS.some((ext) => n.endsWith(ext))
}

export default function FileUploadZone({ onValidar, cargando, error }) {
  const [archivoSeleccionado, setArchivoSeleccionado] = useState(null)
  const [errorLocal, setErrorLocal] = useState('')
  const [arrastrando, setArrastrando] = useState(false)
  const inputRef = useRef(null)

  const seleccionarArchivo = useCallback((file) => {
    if (!file) return
    if (!extensionValida(file.name)) {
      setErrorLocal('Solo se permiten archivos .xlsx o .xls.')
      setArchivoSeleccionado(null)
      return
    }
    if (file.size > TAMANO_MAXIMO_BYTES) {
      setErrorLocal(`El archivo supera el tamaño máximo permitido (${formatNumber(TAMANO_MAXIMO_BYTES / (1024 * 1024))} MB).`)
      setArchivoSeleccionado(null)
      return
    }
    setErrorLocal('')
    setArchivoSeleccionado(file)
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setArrastrando(false)
    seleccionarArchivo(e.dataTransfer.files?.[0])
  }, [seleccionarArchivo])

  const limpiarSeleccion = () => {
    setArchivoSeleccionado(null)
    setErrorLocal('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <div
        className={`upload-dropzone ${arrastrando ? 'upload-dropzone--active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Zona de carga de archivo Excel"
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          data-testid="input-archivo"
          style={{ display: 'none' }}
          onChange={(e) => seleccionarArchivo(e.target.files?.[0])}
        />
        <p className="mb-1">Arrastra aquí tu archivo Excel o haz clic para seleccionarlo</p>
        <p className="chart-panel__subtitle mb-0">Formatos permitidos: .xlsx, .xls</p>
      </div>

      {(errorLocal || error) && (
        <Alert variant="danger" className="mt-3 mb-0">{errorLocal || error}</Alert>
      )}

      {archivoSeleccionado && (
        <div className="mt-3 d-flex flex-wrap gap-3 align-items-center">
          <div>
            <strong>{archivoSeleccionado.name}</strong>
            <div className="chart-panel__subtitle mb-0">
              {(archivoSeleccionado.size / 1024).toFixed(1)} KB · {new Date(archivoSeleccionado.lastModified).toLocaleDateString('es-EC')}
            </div>
          </div>
        </div>
      )}

      <div className="d-flex gap-2 mt-3">
        <Button
          variant="primary"
          disabled={!archivoSeleccionado || cargando}
          onClick={() => onValidar(archivoSeleccionado)}
        >
          {cargando ? <Spinner size="sm" animation="border" className="me-2" /> : null}
          Validar archivo
        </Button>
        <Button variant="outline-secondary" disabled={cargando} onClick={limpiarSeleccion}>
          Limpiar
        </Button>
      </div>
    </div>
  )
}
