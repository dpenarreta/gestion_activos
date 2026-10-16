import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'

/**
 * Pide la contraseña del propio usuario para dejar pasar UN cambio estructural en un dashboard
 * con el diseño bloqueado (`Dashboard.estructura_bloqueada`, ver `services/desbloqueo.py`).
 *
 * No desbloquea el dashboard ni abre una ventana de tiempo: autoriza la operación que está en
 * curso y nada más. Por eso el modal se cierra solo al terminar y la próxima vez vuelve a pedirla
 * — que es incómodo a propósito, porque el bloqueo existe justamente para que mover una sección
 * no sea algo que se pueda hacer de paso.
 *
 * La contraseña vive únicamente en el estado de este componente y se limpia al cerrar: no se
 * guarda en `localStorage`, ni en el contexto, ni se reutiliza para la operación siguiente.
 */
export default function ConfirmarClaveModal({ show, accion, onConfirmar, onCancelar }) {
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const campo = useRef(null)

  useEffect(() => {
    if (show) {
      setClave('')
      setError('')
      setEnviando(false)
    }
  }, [show])

  const confirmar = async (evento) => {
    evento.preventDefault()
    if (!clave || enviando) return
    setEnviando(true)
    setError('')
    const resultado = await onConfirmar(clave)
    // `onConfirmar` devuelve `{ ok }`: si la contraseña no era correcta el modal se queda abierto
    // con el mensaje, en vez de cerrarse y perder lo que la persona estaba haciendo.
    if (resultado?.ok) return
    setError(resultado?.mensaje || 'No se pudo confirmar.')
    setClave('')
    setEnviando(false)
    campo.current?.focus()
  }

  return (
    <Modal show={show} onHide={onCancelar} centered>
      <Form onSubmit={confirmar}>
        <Modal.Header closeButton>
          <Modal.Title>Confirmá tu contraseña</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-3">
            El diseño de este dashboard está bloqueado. Para {accion || 'hacer este cambio'},
            escribí tu contraseña.
          </p>
          {error && <Alert variant="danger" className="py-2">{error}</Alert>}
          <Form.Group controlId="clave-desbloqueo">
            <Form.Label>Contraseña</Form.Label>
            <Form.Control
              ref={campo}
              type="password"
              value={clave}
              autoComplete="current-password"
              autoFocus
              onChange={(e) => setClave(e.target.value)}
              disabled={enviando}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onCancelar} disabled={enviando}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={!clave || enviando}>
            {enviando && <Spinner animation="border" size="sm" className="me-2" />}
            Confirmar
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
}
