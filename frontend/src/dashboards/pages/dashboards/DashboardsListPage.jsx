import { useEffect, useState } from 'react'
import { Accordion, Alert, Button, Form, Modal, Spinner } from 'react-bootstrap'
import ModalConCambios from '../../components/common/ModalConCambios'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import * as dashboardLayoutService from '../../services/dashboardLayoutService'
import * as rolesService from '../../services/rolesService'
import * as usersService from '../../services/usersService'

function rutaDashboard(dashboardId) {
  return `/admin/dashboards/${dashboardId}`
}

function ModalCrearDashboard({ show, onHide, onCreado }) {
  const [name, setName] = useState('')
  const [area, setArea] = useState('')
  const [description, setDescription] = useState('')
  const [contexto, setContexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const limpiarYCerrar = () => {
    setName(''); setArea(''); setDescription(''); setContexto(''); setError('')
    onHide()
  }

  const enviar = async (e) => {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      const dashboard = await dashboardLayoutService.crearDashboard({ name, area, description, contexto })
      onCreado(dashboard)
      limpiarYCerrar()
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudo crear el dashboard.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <ModalConCambios show={show} onHide={limpiarYCerrar}>
      <Modal.Header closeButton closeLabel="Cerrar">
        <Modal.Title>Crear dashboard</Modal.Title>
      </Modal.Header>
      <Form onSubmit={enviar}>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form.Group className="mb-3" controlId="crear-dashboard-name">
            <Form.Label>Nombre</Form.Label>
            <Form.Control value={name} onChange={(e) => setName(e.target.value)} required autoFocus disabled={guardando} />
          </Form.Group>
          <Form.Group className="mb-3" controlId="crear-dashboard-area">
            <Form.Label>Área</Form.Label>
            <Form.Control value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ej. Finanzas, Logística..." disabled={guardando} />
          </Form.Group>
          <Form.Group className="mb-3" controlId="crear-dashboard-description">
            <Form.Label>Descripción (opcional)</Form.Label>
            <Form.Control as="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={guardando} />
          </Form.Group>
          <Form.Group controlId="crear-dashboard-contexto">
            <Form.Label>Contexto para la IA (opcional)</Form.Label>
            <Form.Control
              as="textarea" rows={3} maxLength={3000} value={contexto}
              onChange={(e) => setContexto(e.target.value)} disabled={guardando}
              placeholder="Ej. Este dashboard muestra la cartera vencida de la región norte, cargada mensualmente por el equipo de cobranza..."
            />
            <Form.Text>
              No se muestra dentro del dashboard — se usa para que la IA entienda mejor los datos
              al generar la interpretación completa y los hallazgos clave.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={limpiarYCerrar} disabled={guardando} type="button">Cancelar</Button>
          <Button variant="primary" type="submit" disabled={guardando}>
            {guardando ? <><Spinner size="sm" animation="border" aria-hidden="true" /><span className="visually-hidden">Creando…</span></> : 'Crear'}
          </Button>
        </Modal.Footer>
      </Form>
    </ModalConCambios>
  )
}

/**
 * "Editar dashboard" reúne, en un único modal, tanto el nombre/área (gateado por el permiso
 * global `dashboard.editar`) como el control de acceso por dashboard (gateado por
 * `d.puede_administrar_acceso` — dueño o `dashboard.administrar_acceso`, ver `cartera/permisos.py`). No son la misma
 * autorización, así que cada sección solo se muestra si el usuario tiene el permiso
 * correspondiente: un dueño sin `dashboard.editar` global igual puede abrir este modal para
 * gestionar el acceso, solo que sin ver los campos de nombre/área.
 */
function ModalEditarDashboard({ show, dashboard, onHide, onEditado }) {
  const { user } = useAuth()
  const puedeEditarNombre = user?.permissions?.includes('dashboard.editar')
  // Reasignar el dueño pide su permiso (21/10/2026; antes, ser superusuario).
  const puedeReasignarDueno = Boolean(user?.permissions?.includes('dashboard.reasignar_dueno'))
  const puedeAdministrarAcceso = Boolean(dashboard?.puede_administrar_acceso)

  const [name, setName] = useState('')
  const [area, setArea] = useState('')
  const [contexto, setContexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const [cargandoAcceso, setCargandoAcceso] = useState(false)
  const [rolesDisponibles, setRolesDisponibles] = useState([])
  const [usuariosDisponibles, setUsuariosDisponibles] = useState([])
  const [editores, setEditores] = useState([])
  const [lectores, setLectores] = useState([])
  const [duenoId, setDuenoId] = useState('')
  const [duenoOriginalId, setDuenoOriginalId] = useState('')

  useEffect(() => {
    if (dashboard) {
      setName(dashboard.name || '')
      setArea(dashboard.area || '')
      setContexto(dashboard.contexto || '')
      setError('')
    }
  }, [dashboard])

  useEffect(() => {
    if (!show || !dashboard || !dashboard.puede_administrar_acceso) return
    setCargandoAcceso(true)
    const solicitudes = [rolesService.list(), dashboardLayoutService.obtenerAcceso(dashboard.dashboard_id)]
    if (puedeReasignarDueno) solicitudes.push(usersService.list({ page_size: 200 }))

    Promise.all(solicitudes)
      .then(([rolesData, acceso, usuariosData]) => {
        setRolesDisponibles(rolesData.results || [])
        setEditores(acceso.roles_editores.map((r) => r.id))
        setLectores(acceso.roles_lectores.map((r) => r.id))
        const ownerId = acceso.owner?.id || ''
        setDuenoId(ownerId)
        setDuenoOriginalId(ownerId)
        if (usuariosData) setUsuariosDisponibles(usuariosData.results || [])
      })
      .catch(() => setError('No se pudo cargar el acceso de este dashboard.'))
      .finally(() => setCargandoAcceso(false))
  }, [show, dashboard, puedeReasignarDueno])

  const marcarEditor = (rolId, marcado) => {
    setEditores((actual) => (marcado ? [...actual, rolId] : actual.filter((id) => id !== rolId)))
    if (marcado) setLectores((actual) => actual.filter((id) => id !== rolId))
  }

  const marcarLector = (rolId, marcado) => {
    setLectores((actual) => (marcado ? [...actual, rolId] : actual.filter((id) => id !== rolId)))
    if (marcado) setEditores((actual) => actual.filter((id) => id !== rolId))
  }

  const cerrar = () => { setError(''); onHide() }

  const enviar = async (e) => {
    e.preventDefault()
    setGuardando(true)
    setError('')
    try {
      let actualizado = dashboard
      if (puedeEditarNombre) {
        actualizado = await dashboardLayoutService.actualizarDashboard(dashboard.dashboard_id, { name, area, contexto })
      }
      if (puedeAdministrarAcceso) {
        await dashboardLayoutService.actualizarAcceso(dashboard.dashboard_id, { rolesEditores: editores, rolesLectores: lectores })
        if (puedeReasignarDueno && duenoId !== duenoOriginalId) {
          await dashboardLayoutService.reasignarDueno(dashboard.dashboard_id, duenoId || null)
        }
      }
      onEditado(actualizado)
      cerrar()
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudo editar el dashboard.')
    } finally {
      setGuardando(false)
    }
  }

  const secciones = [
    puedeEditarNombre && 'general',
    puedeAdministrarAcceso && 'permisos',
    puedeAdministrarAcceso && 'dueno',
  ].filter(Boolean)

  return (
    <ModalConCambios show={show} onHide={cerrar} size={puedeAdministrarAcceso ? 'lg' : undefined}>
      <Modal.Header closeButton closeLabel="Cerrar">
        <Modal.Title>Editar dashboard</Modal.Title>
      </Modal.Header>
      <Form onSubmit={enviar}>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}

          <Accordion defaultActiveKey={secciones} alwaysOpen>
            {puedeEditarNombre && (
              <Accordion.Item eventKey="general">
                <Accordion.Header>Ajustes generales</Accordion.Header>
                <Accordion.Body>
                  <Form.Group className="mb-3" controlId="editar-dashboard-name">
                    <Form.Label>Nombre</Form.Label>
                    <Form.Control value={name} onChange={(e) => setName(e.target.value)} required autoFocus disabled={guardando} />
                  </Form.Group>
                  <Form.Group className="mb-3" controlId="editar-dashboard-area">
                    <Form.Label>Área</Form.Label>
                    <Form.Control value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ej. Finanzas, Logística..." disabled={guardando} />
                  </Form.Group>
                  <Form.Group controlId="editar-dashboard-contexto">
                    <Form.Label>Contexto para la IA (opcional)</Form.Label>
                    <Form.Control
                      as="textarea" rows={3} maxLength={3000} value={contexto}
                      onChange={(e) => setContexto(e.target.value)} disabled={guardando}
                      placeholder="Ej. Este dashboard muestra la cartera vencida de la región norte, cargada mensualmente por el equipo de cobranza..."
                    />
                    <Form.Text>
                      No se muestra dentro del dashboard — se usa para que la IA entienda mejor los
                      datos al generar la interpretación completa y los hallazgos clave.
                    </Form.Text>
                  </Form.Group>
                </Accordion.Body>
              </Accordion.Item>
            )}

            {puedeAdministrarAcceso && (
              <Accordion.Item eventKey="permisos">
                <Accordion.Header>Permisos de visualización y edición</Accordion.Header>
                <Accordion.Body>
                  <p className="chart-panel__subtitle">
                    Roles con acceso a este dashboard. Un dashboard sin ningún rol asignado sigue
                    siendo visible para cualquiera con el permiso general de ver dashboards.
                  </p>

                  {cargandoAcceso ? (
                    <div className="text-center" role="status" aria-live="polite"><Spinner animation="border" aria-hidden="true" /><span className="visually-hidden">Cargando…</span></div>
                  ) : (
                    <div className="d-flex gap-4 flex-wrap">
                      <div style={{ minWidth: 220 }}>
                        <Form.Label className="fw-bold">Ver y editar</Form.Label>
                        {rolesDisponibles.map((rol) => (
                          <Form.Check
                            key={`editor-${rol.id}`}
                            type="checkbox"
                            id={`acceso-editor-${rol.id}`}
                            label={rol.name}
                            checked={editores.includes(rol.id)}
                            onChange={(e) => marcarEditor(rol.id, e.target.checked)}
                            disabled={guardando}
                          />
                        ))}
                      </div>
                      <div style={{ minWidth: 220 }}>
                        <Form.Label className="fw-bold">Solo ver</Form.Label>
                        {rolesDisponibles.map((rol) => (
                          <Form.Check
                            key={`lector-${rol.id}`}
                            type="checkbox"
                            id={`acceso-lector-${rol.id}`}
                            label={rol.name}
                            checked={lectores.includes(rol.id)}
                            onChange={(e) => marcarLector(rol.id, e.target.checked)}
                            disabled={guardando}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </Accordion.Body>
              </Accordion.Item>
            )}

            {puedeAdministrarAcceso && (
              <Accordion.Item eventKey="dueno">
                <Accordion.Header>Dueño del tablero</Accordion.Header>
                <Accordion.Body>
                  {cargandoAcceso ? (
                    <div className="text-center" role="status" aria-live="polite"><Spinner animation="border" aria-hidden="true" /><span className="visually-hidden">Cargando…</span></div>
                  ) : puedeReasignarDueno ? (
                    <Form.Group controlId="acceso-dueno">
                      <Form.Label className="fw-bold">Dueño</Form.Label>
                      <Form.Select value={duenoId} onChange={(e) => setDuenoId(e.target.value)} disabled={guardando}>
                        <option value="">Sin dueño</option>
                        {usuariosDisponibles.map((u) => (
                          <option key={u.id} value={u.id}>{u.username}</option>
                        ))}
                      </Form.Select>
                    </Form.Group>
                  ) : (
                    <p className="chart-panel__subtitle mb-0">
                      Reasignar el dueño requiere el permiso «Reasignar el dueño de cualquier dashboard»;
                      solicítelo a un administrador si lo necesita.
                    </p>
                  )}
                </Accordion.Body>
              </Accordion.Item>
            )}
          </Accordion>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={cerrar} disabled={guardando} type="button">Cancelar</Button>
          <Button variant="primary" type="submit" disabled={guardando || cargandoAcceso}>
            {guardando ? <><Spinner size="sm" animation="border" aria-hidden="true" /><span className="visually-hidden">Guardando…</span></> : 'Guardar cambios'}
          </Button>
        </Modal.Footer>
      </Form>
    </ModalConCambios>
  )
}

function ModalEliminarDashboard({ show, dashboard, onHide, onEliminado }) {
  const [confirmacion, setConfirmacion] = useState('')
  const [eliminando, setEliminando] = useState(false)
  const [error, setError] = useState('')

  const cerrar = () => { setConfirmacion(''); setError(''); onHide() }
  const coincide = Boolean(dashboard) && confirmacion === dashboard.name

  const eliminar = async () => {
    setEliminando(true)
    setError('')
    try {
      await dashboardLayoutService.eliminarDashboard(dashboard.dashboard_id, confirmacion)
      onEliminado(dashboard.dashboard_id)
      cerrar()
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudo eliminar el dashboard.')
    } finally {
      setEliminando(false)
    }
  }

  return (
    <Modal backdrop="static" show={show} onHide={cerrar}>
      <Modal.Header closeButton closeLabel="Cerrar">
        <Modal.Title>Eliminar dashboard</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        <p>Esta acción no se puede deshacer. Para confirmar, escriba exactamente el nombre del dashboard:</p>
        <span className="fw-bold d-block mb-2">{dashboard?.name}</span>
        <Form.Control
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          disabled={eliminando}
          autoFocus
          aria-label="Confirmar nombre del dashboard"
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={cerrar} disabled={eliminando}>Cancelar</Button>
        <Button variant="danger" disabled={!coincide || eliminando} onClick={eliminar}>
          {eliminando ? <><Spinner size="sm" animation="border" aria-hidden="true" /><span className="visually-hidden">Eliminando…</span></> : 'Eliminar'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

/**
 * Tarjeta de "Mis dashboards" — auditoría UX/UI, fase 3, 28/10/2026. Antes la tarjeta no era un
 * enlace y «Entrar», «Editar» y «Eliminar» vivían en una capa con opacity: 0 que solo aparecía al
 * pasar el cursor: invisible en pantallas táctiles y sin pista de que había algo que hacer. Ahora
 * toda la tarjeta es el enlace al dashboard y Editar/Eliminar son botones de ícono siempre
 * visibles en la esquina, hermanos del enlace (un botón no puede ir dentro de un `<a>`), con el
 * nombre del dashboard en su `aria-label`. "Editar" también se muestra sin el permiso global
 * cuando el usuario es dueño/superusuario de este dashboard puntual (`puede_administrar_acceso`),
 * aunque solo vea dentro la sección de control de acceso, no los campos de nombre/área.
 */
function DashboardCard({ dashboard, puedeEditar, puedeEliminar, onEditar, onEliminar }) {
  const conAcciones = puedeEditar || puedeEliminar
  return (
    <div
      className={`dashboard-card${conAcciones ? ' dashboard-card--con-acciones' : ''}`}
      data-testid={`dashboard-card-${dashboard.dashboard_id}`}
    >
      <Link to={rutaDashboard(dashboard.dashboard_id)} className="dashboard-card__enlace mz-card h-100">
        <span className="mz-row dashboard-card__fila">
          <span className="mz-row-ic"><i className="bi bi-bar-chart-line" aria-hidden="true"></i></span>
          <span className="mz-row-info">
            <strong>{dashboard.name}</strong>
            {dashboard.area && <span>{dashboard.area}</span>}
          </span>
        </span>
      </Link>
      {conAcciones && (
        <div className="dashboard-card__acciones">
          {puedeEditar && (
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={onEditar}
              aria-label={`Editar "${dashboard.name}"`}
              title="Editar"
            >
              <i className="bi bi-pencil" aria-hidden="true"></i>
            </Button>
          )}
          {puedeEliminar && (
            <Button
              size="sm"
              variant="outline-danger"
              onClick={onEliminar}
              aria-label={`Eliminar "${dashboard.name}"`}
              title="Eliminar"
            >
              <i className="bi bi-trash" aria-hidden="true"></i>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export default function DashboardsListPage() {
  const { user } = useAuth()
  const puedeCrear = user?.permissions?.includes('dashboard.crear')
  const puedeEditar = user?.permissions?.includes('dashboard.editar')
  const puedeEliminar = user?.permissions?.includes('dashboard.eliminar')

  const [dashboards, setDashboards] = useState(null)
  const [error, setError] = useState('')
  const [mostrarModalCrear, setMostrarModalCrear] = useState(false)
  const [dashboardAEditar, setDashboardAEditar] = useState(null)
  const [dashboardAEliminar, setDashboardAEliminar] = useState(null)

  const cargar = () => {
    dashboardLayoutService.obtenerDashboardsAutorizados()
      .then(setDashboards)
      .catch(() => setError('No se pudieron cargar los dashboards autorizados.'))
  }

  useEffect(cargar, [])

  return (
    <div className="cartera-app">
      <div className="mz-view-head">
        <div>
          <h2>Mis dashboards</h2>
          <p className="mz-desc">Los dashboards que tiene autorizados. Seleccione uno para entrar.</p>
        </div>
        {puedeCrear && (
          <div className="mz-view-actions">
            <Button size="sm" onClick={() => setMostrarModalCrear(true)}><i className="bi bi-plus-lg" aria-hidden="true"></i> Crear dashboard</Button>
          </div>
        )}
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {!dashboards && !error && (
        <div className="text-center" role="status" aria-live="polite"><Spinner animation="border" aria-hidden="true" /><span className="visually-hidden">Cargando…</span></div>
      )}
      {dashboards && dashboards.length === 0 && (
        <div className="mz-card mz-empty">
          <i className="bi bi-bar-chart-line d-block mb-2" aria-hidden="true"></i>
          No tiene ningún dashboard autorizado. Contacte a un administrador.
        </div>
      )}

      <div className="dashboards-grid">
        {dashboards?.map((d) => (
          <DashboardCard
            key={d.dashboard_id}
            dashboard={d}
            puedeEditar={Boolean(puedeEditar || d.puede_administrar_acceso)}
            puedeEliminar={Boolean(puedeEliminar)}
            onEditar={() => setDashboardAEditar(d)}
            onEliminar={() => setDashboardAEliminar(d)}
          />
        ))}
      </div>

      <ModalCrearDashboard
        show={mostrarModalCrear}
        onHide={() => setMostrarModalCrear(false)}
        onCreado={cargar}
      />

      <ModalEditarDashboard
        show={Boolean(dashboardAEditar)}
        dashboard={dashboardAEditar}
        onHide={() => setDashboardAEditar(null)}
        onEditado={cargar}
      />

      <ModalEliminarDashboard
        show={Boolean(dashboardAEliminar)}
        dashboard={dashboardAEliminar}
        onHide={() => setDashboardAEliminar(null)}
        onEliminado={cargar}
      />
    </div>
  )
}
