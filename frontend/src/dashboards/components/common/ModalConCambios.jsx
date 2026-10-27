import { useCallback, useRef, useState } from 'react'
import { Modal } from 'react-bootstrap'
import { MENSAJE_DESCARTE, TITULO_DESCARTE } from '../../../components/common/ConfirmarDescarte/confirmarDescarte'
import { vigilarDescarte } from '../../../hooks/vigilarDescarte'
import ConfirmModal from '../dashboard-editor/ConfirmModal'

/**
 * `Modal` de un formulario: no se cierra con un clic fuera y, si se escribió
 * algo, Escape, la X y «Cancelar» preguntan antes de descartarlo
 * (27/10/2026: se perdía lo escrito sin aviso).
 */
export default function ModalConCambios({ show, onHide, children, ...props }) {
  const [responder, setResponder] = useState(null)
  const vigilancia = useRef(null)
  const pendiente = useRef(null)

  // Una sola pregunta a la vez: dos Escape seguidos reciben la misma.
  const preguntar = useCallback(() => {
    if (!pendiente.current) {
      pendiente.current = new Promise((resolve) => setResponder(() => resolve))
    }
    return pendiente.current
  }, [])

  // El contenido se monta y desmonta con la ventana: cada apertura empieza
  // sin cambios.
  const raiz = useCallback(
    (nodo) => {
      vigilancia.current?.desmontar()
      vigilancia.current = nodo ? vigilarDescarte(nodo, { preguntar, soloEnFormulario: false }) : null
    },
    [preguntar],
  )

  // Escape y la X del encabezado llegan por aquí.
  function ocultar() {
    if (!vigilancia.current?.estaSucio()) {
      onHide()
      return
    }
    preguntar().then((descartar) => {
      if (descartar) {
        vigilancia.current?.olvidar()
        onHide()
      }
    })
  }

  function contestar(descartar) {
    pendiente.current = null
    responder?.(descartar)
    setResponder(null)
  }

  return (
    <>
      <Modal backdrop="static" show={show} onHide={ocultar} {...props}>
        <div ref={raiz} style={{ display: 'contents' }}>
          {children}
        </div>
      </Modal>
      <ConfirmModal
        show={Boolean(responder)}
        title={TITULO_DESCARTE}
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        onConfirm={() => contestar(true)}
        onCancel={() => contestar(false)}
      >
        {MENSAJE_DESCARTE}
      </ConfirmModal>
    </>
  )
}
