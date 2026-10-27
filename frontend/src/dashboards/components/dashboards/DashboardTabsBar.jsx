import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Form, Modal, Nav, Spinner } from 'react-bootstrap'
import ModalConCambios from '../common/ModalConCambios'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import * as dashboardLayoutService from '../../services/dashboardLayoutService'

const LIMITE_PESTANAS = 5

function ModalCrearPestana({ show, onHide, onCreada }) {
  const [name, setName] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const limpiarYCerrar = () => {
    setName(''); setError('')
    onHide()
  }

  const enviar = async (e) => {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      const pestana = await onCreada(name)
      if (pestana) limpiarYCerrar()
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudo crear la pestaña.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <ModalConCambios show={show} onHide={limpiarYCerrar}>
      <Modal.Header closeButton closeLabel="Cerrar">
        <Modal.Title>Nueva pestaña</Modal.Title>
      </Modal.Header>
      <Form onSubmit={enviar}>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form.Group controlId="crear-pestana-name">
            <Form.Label>Nombre</Form.Label>
            <Form.Control value={name} onChange={(e) => setName(e.target.value)} required autoFocus disabled={guardando} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={limpiarYCerrar} disabled={guardando} type="button">Cancelar</Button>
          <Button variant="primary" type="submit" disabled={guardando}>
            {guardando ? <Spinner size="sm" animation="border" /> : 'Crear'}
          </Button>
        </Modal.Footer>
      </Form>
    </ModalConCambios>
  )
}

function ModalEditarPestana({ show, pestana, onHide, onEditada }) {
  const [name, setName] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (pestana) {
      setName(pestana.name || '')
      setError('')
    }
  }, [pestana])

  const cerrar = () => { setError(''); onHide() }

  const enviar = async (e) => {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      // Se reenvía `area` tal cual está para no borrarla: `actualizar_dashboard` sobreescribe el
      // área con lo que reciba, y esta pestaña ya trae la suya heredada de la raíz.
      await dashboardLayoutService.actualizarDashboard(pestana.dashboard_id, { name, area: pestana.area })
      await onEditada()
      cerrar()
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudo editar la pestaña.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <ModalConCambios show={show} onHide={cerrar}>
      <Modal.Header closeButton closeLabel="Cerrar">
        <Modal.Title>Editar pestaña</Modal.Title>
      </Modal.Header>
      <Form onSubmit={enviar}>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form.Group controlId="editar-pestana-name">
            <Form.Label>Nombre</Form.Label>
            <Form.Control value={name} onChange={(e) => setName(e.target.value)} required autoFocus disabled={guardando} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={cerrar} disabled={guardando} type="button">Cancelar</Button>
          <Button variant="primary" type="submit" disabled={guardando}>
            {guardando ? <Spinner size="sm" animation="border" /> : 'Guardar cambios'}
          </Button>
        </Modal.Footer>
      </Form>
    </ModalConCambios>
  )
}

function ModalEliminarPestana({ show, pestana, onHide, onEliminada }) {
  const [confirmacion, setConfirmacion] = useState('')
  const [eliminando, setEliminando] = useState(false)
  const [error, setError] = useState('')

  const cerrar = () => { setConfirmacion(''); setError(''); onHide() }
  const coincide = Boolean(pestana) && confirmacion === pestana.name

  const eliminar = async () => {
    setEliminando(true)
    setError('')
    try {
      await dashboardLayoutService.eliminarDashboard(pestana.dashboard_id, confirmacion)
      await onEliminada(pestana)
      cerrar()
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudo eliminar la pestaña.')
    } finally {
      setEliminando(false)
    }
  }

  return (
    <Modal backdrop="static" show={show} onHide={cerrar}>
      <Modal.Header closeButton closeLabel="Cerrar">
        <Modal.Title>Eliminar pestaña</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        <p>Esta acción no se puede deshacer. Para confirmar, escriba exactamente el nombre de la pestaña:</p>
        <span className="fw-bold d-block mb-2">{pestana?.name}</span>
        <Form.Control
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          disabled={eliminando}
          autoFocus
          aria-label="Confirmar nombre de la pestaña"
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={cerrar} disabled={eliminando}>Cancelar</Button>
        <Button variant="danger" disabled={!coincide || eliminando} onClick={eliminar}>
          {eliminando ? <Spinner size="sm" animation="border" /> : 'Eliminar'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

/**
 * Barra de pestañas de un dashboard. Cada pestaña es un `Dashboard` completamente independiente
 * (propia plantilla, propio archivo) enlazado a una raíz por `Dashboard.parent` en el backend —
 * cambiar de pestaña es solo navegar a la ruta `/admin/dashboards/:dashboardId` de esa pestaña.
 * Siempre visible, incluso si el dashboard todavía no tiene ninguna pestaña adicional (muestra la
 * raíz sola más el "+"), hasta un máximo de `LIMITE_PESTANAS`.
 * En modo edición (`modoEdicion`, activado por "Editar dashboard"), la pestaña activa gana un
 * lápiz para renombrarla y, junto a él, una papelera para eliminarla — igual que cualquier otro
 * dashboard, una pestaña es solo un `Dashboard` más, así que ambas acciones reutilizan
 * `actualizarDashboard`/`eliminarDashboard` (esta última exige escribir el nombre exacto de la
 * pestaña, mismo patrón que "Eliminar dashboard" en `DashboardsListPage.jsx`). Eliminar la pestaña
 * raíz elimina también las demás pestañas de la familia (igual que ya hace `eliminar_dashboard`
 * en el backend), así que en ese caso navega de vuelta a "Mis dashboards"; eliminar cualquier otra
 * pestaña navega a la raíz.
 */
export default function DashboardTabsBar({ dashboardId, modoEdicion = false }) {
  const { user } = useAuth()
  const puedeCrear = user?.permissions?.includes('dashboard.crear')
  const puedeEditar = user?.permissions?.includes('dashboard.editar')
  const puedeEliminar = user?.permissions?.includes('dashboard.eliminar')
  const navigate = useNavigate()

  const [pestanas, setPestanas] = useState(null)
  const [mostrarModalCrear, setMostrarModalCrear] = useState(false)
  const [mostrarModalEditar, setMostrarModalEditar] = useState(false)
  const [mostrarModalEliminar, setMostrarModalEliminar] = useState(false)

  // `useCallback` + `cargar` en las dependencias del efecto, en vez de la supresión con
  // `eslint-disable-line` que usan otros 13 lugares del repo: acá la corrección real es de una
  // línea. Sin memoizar, `cargar` se recreaba en cada render y no podía listarse (habría
  // reejecutado el efecto en bucle), así que la única dependencia declarada era `dashboardId`.
  // Funcionaba porque es lo único que `cargar` captura hoy — pero cualquier dependencia que se le
  // agregue después dejaría el efecto sin volver a dispararse, con la clausura vieja.
  const cargar = useCallback(() => {
    return dashboardLayoutService.obtenerPestanas(dashboardId).then(setPestanas).catch(() => setPestanas(null))
  }, [dashboardId])

  useEffect(() => { cargar() }, [cargar])

  const crear = async (name) => {
    const pestana = await dashboardLayoutService.crearPestana(dashboardId, { name })
    navigate(`/admin/dashboards/${pestana.dashboard_id}`)
    return pestana
  }

  const eliminada = (pestanaEliminada) => {
    const raiz = pestanas[0]
    const eraRaiz = pestanaEliminada.dashboard_id === raiz?.dashboard_id
    navigate(eraRaiz || !raiz ? '/admin/dashboards' : `/admin/dashboards/${raiz.dashboard_id}`)
  }

  if (!pestanas) return null

  const pestanaActiva = pestanas.find((p) => p.dashboard_id === dashboardId)

  return (
    <>
      <Nav variant="tabs" className="mb-3">
        {pestanas.map((p) => (
          <Nav.Item key={p.dashboard_id}>
            <Nav.Link as={Link} to={`/admin/dashboards/${p.dashboard_id}`} active={p.dashboard_id === dashboardId} className="d-flex align-items-center gap-2">
              {p.name}
              {modoEdicion && p.dashboard_id === dashboardId && (
                <>
                  {puedeEditar && (
                    <span
                      role="button"
                      aria-label="Editar nombre de la pestaña"
                      className="text-secondary"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMostrarModalEditar(true) }}
                    >
                      <i className="bi bi-pencil" aria-hidden="true"></i>
                    </span>
                  )}
                  {puedeEliminar && (
                    <span
                      role="button"
                      aria-label="Eliminar pestaña"
                      className="text-danger"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMostrarModalEliminar(true) }}
                    >
                      <i className="bi bi-trash" aria-hidden="true"></i>
                    </span>
                  )}
                </>
              )}
            </Nav.Link>
          </Nav.Item>
        ))}
        {puedeCrear && pestanas.length < LIMITE_PESTANAS && (
          <Nav.Item>
            <Nav.Link onClick={() => setMostrarModalCrear(true)} aria-label="Agregar pestaña"><i className="bi bi-plus-lg" aria-hidden="true"></i></Nav.Link>
          </Nav.Item>
        )}
      </Nav>

      <ModalCrearPestana show={mostrarModalCrear} onHide={() => setMostrarModalCrear(false)} onCreada={crear} />

      <ModalEditarPestana
        show={mostrarModalEditar}
        pestana={pestanaActiva}
        onHide={() => setMostrarModalEditar(false)}
        onEditada={cargar}
      />

      <ModalEliminarPestana
        show={mostrarModalEliminar}
        pestana={pestanaActiva}
        onHide={() => setMostrarModalEliminar(false)}
        onEliminada={eliminada}
      />
    </>
  )
}
