import { useEffect, useMemo, useRef, useState } from 'react'
import { Accordion, Alert, Button, Form, Modal, Spinner, Table } from 'react-bootstrap'
import ModalConCambios from '../../components/common/ModalConCambios'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import * as dashboardLayoutService from '../../services/dashboardLayoutService'
import * as rolesService from '../../services/rolesService'
import * as usersService from '../../services/usersService'

function rutaDashboard(dashboardId) {
  return `/admin/dashboards/${dashboardId}`
}

// El buscador de roles no distingue mayúsculas ni tildes (US-003, 11/11/2026): «analisis»
// encuentra «Análisis».
function normalizarTexto(texto) {
  return (texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
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
  const [busquedaRol, setBusquedaRol] = useState('')
  const [errorAcceso, setErrorAcceso] = useState(false)
  const [intentoAcceso, setIntentoAcceso] = useState(0)
  // `n` cambia en cada anuncio para que se repita aunque el texto sea el mismo.
  const [anuncioAcceso, setAnuncioAcceso] = useState({ texto: '', n: 0 })
  const buscadorRef = useRef(null)
  const reintentarRef = useRef(null)
  const enfocarTrasReintento = useRef(false)

  useEffect(() => {
    if (dashboard) {
      setName(dashboard.name || '')
      setArea(dashboard.area || '')
      setContexto(dashboard.contexto || '')
      setError('')
    }
  }, [dashboard])

  useEffect(() => {
    if (!show || !dashboard || !dashboard.puede_administrar_acceso) return undefined
    // Cada apertura empieza en blanco (US-003, 11/11/2026): si la carga falla, no deben quedar los
    // roles y el dueño del dashboard abierto antes, que se guardarían sobre este.
    let vigente = true
    setCargandoAcceso(true)
    setErrorAcceso(false)
    setBusquedaRol('')
    setAnuncioAcceso((actual) => ({ texto: '', n: actual.n }))
    setRolesDisponibles([])
    setUsuariosDisponibles([])
    setEditores([])
    setLectores([])
    setDuenoId('')
    setDuenoOriginalId('')
    const solicitudes = [rolesService.list(), dashboardLayoutService.obtenerAcceso(dashboard.dashboard_id)]
    if (puedeReasignarDueno) solicitudes.push(usersService.list({ page_size: 200 }))

    Promise.all(solicitudes)
      .then(([rolesData, acceso, usuariosData]) => {
        if (!vigente) return
        const idsEditores = acceso.roles_editores.map((r) => r.id)
        setRolesDisponibles(rolesData.results || [])
        setEditores(idsEditores)
        // Un rol nunca va en las dos listas: si el backend lo trae en ambas, gana «editor».
        setLectores(acceso.roles_lectores.map((r) => r.id).filter((id) => !idsEditores.includes(id)))
        const ownerId = acceso.owner?.id || ''
        setDuenoId(ownerId)
        setDuenoOriginalId(ownerId)
        if (usuariosData) setUsuariosDisponibles(usuariosData.results || [])
      })
      .catch(() => { if (vigente) setErrorAcceso(true) })
      .finally(() => { if (vigente) setCargandoAcceso(false) })
    return () => { vigente = false }
  }, [show, dashboard, puedeReasignarDueno, intentoAcceso])

  // Tras «Reintentar», el foco no se pierde en la página: va al buscador si cargó o al nuevo
  // «Reintentar» si volvió a fallar.
  useEffect(() => {
    if (cargandoAcceso || !enfocarTrasReintento.current) return
    enfocarTrasReintento.current = false
    ;(errorAcceso ? reintentarRef : buscadorRef).current?.focus()
  }, [cargandoAcceso, errorAcceso])

  const reintentarAcceso = () => {
    enfocarTrasReintento.current = true
    setIntentoAcceso((n) => n + 1)
  }

  // Una fila por rol con «Ver» y «Editar» (US-003, 11/11/2026). El contrato sigue siendo dos listas
  // excluyentes: `editores` (ver y editar) y `lectores` (solo ver). Editar sin ver no existe, así
  // que marcar «Editar» deja «Ver» marcado y quitar «Ver» quita las dos.
  // Cada clic lee las dos listas del mismo render y escribe las dos: no se mezclan valores del
  // render con actualizaciones funcionales.
  const marcarVer = (rolId, marcado) => {
    const esEditor = editores.includes(rolId)
    const esLector = lectores.includes(rolId)
    if (marcado) {
      if (!esEditor && !esLector) setLectores([...lectores, rolId])
      return
    }
    setLectores(lectores.filter((id) => id !== rolId))
    setEditores(editores.filter((id) => id !== rolId))
    // Quitar «Ver» a un editor también le quita «Editar»: se anuncia para que no pase inadvertido.
    if (esEditor) {
      const rol = rolesDisponibles.find((r) => r.id === rolId)
      setAnuncioAcceso({ texto: `${rol?.name || 'El rol'} ya no puede ver ni editar`, n: anuncioAcceso.n + 1 })
    }
  }

  const marcarEditar = (rolId, marcado) => {
    const esEditor = editores.includes(rolId)
    const esLector = lectores.includes(rolId)
    if (marcado) {
      if (!esEditor) setEditores([...editores, rolId])
      if (esLector) setLectores(lectores.filter((id) => id !== rolId))
      return
    }
    if (esEditor) setEditores(editores.filter((id) => id !== rolId))
    if (!esLector) setLectores([...lectores, rolId])
  }

  // Escape con texto en el buscador solo lo limpia; con el buscador vacío cierra como siempre.
  // Enter no debe guardar ni cerrar la ventana.
  const teclaEnBuscador = (e) => {
    if (e.key === 'Enter') e.preventDefault()
    if (e.key === 'Escape' && busquedaRol) {
      e.preventDefault()
      e.stopPropagation()
      setBusquedaRol('')
    }
  }

  const busquedaNormalizada = normalizarTexto(busquedaRol.trim())
  const rolesFiltrados = useMemo(
    () => (busquedaNormalizada
      ? rolesDisponibles.filter((rol) => normalizarTexto(rol.name).includes(busquedaNormalizada))
      : rolesDisponibles),
    [rolesDisponibles, busquedaNormalizada],
  )
  const { totalPuedenVer, totalPuedenEditar } = useMemo(() => ({
    totalPuedenVer: rolesDisponibles.filter((rol) => lectores.includes(rol.id) || editores.includes(rol.id)).length,
    totalPuedenEditar: rolesDisponibles.filter((rol) => editores.includes(rol.id)).length,
  }), [rolesDisponibles, lectores, editores])

  // Una sola región viva para la carga y el filtro (también el «ningún rol coincide»).
  let anuncioLista = ''
  if (cargandoAcceso) anuncioLista = 'Cargando roles…'
  else if (!errorAcceso && busquedaNormalizada) {
    anuncioLista = rolesFiltrados.length
      ? `Mostrando ${rolesFiltrados.length} de ${rolesDisponibles.length} roles`
      : `Ningún rol coincide con «${busquedaRol.trim()}»`
  }

  const cerrar = () => { setError(''); onHide() }

  // Sin el acceso cargado no se guarda nada (US-003, 11/11/2026): se mandarían listas vacías y se
  // quitaría el acceso a todos los roles. «Guardar cambios» queda deshabilitado hasta reintentar.
  const accesoSinCargar = puedeAdministrarAcceso && (cargandoAcceso || errorAcceso)

  const enviar = async (e) => {
    e.preventDefault()
    if (accesoSinCargar) return
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
                  <div className="dashboard-permisos">
                    {/* La explicación de «sin roles» vive solo en el resumen (QA-UX, 11/11/2026). */}
                    <p className="dashboard-permisos__ayuda">Roles con acceso a este dashboard.</p>
                    <p className="dashboard-permisos__ayuda" id="acceso-ayuda-reglas">
                      Marcar Editar da también Ver. Quitar Ver quita las dos.
                    </p>

                    {/* Regiones vivas siempre montadas: un lector de pantalla solo anuncia cambios
                        en una región que ya existía. El anuncio de «Ver» cambia de nodo (key) en
                        cada clic para repetirse aunque el texto sea el mismo. */}
                    <p className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="anuncio-lista-roles">{anuncioLista}</p>
                    <p className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="anuncio-acceso">
                      <span key={anuncioAcceso.n}>{anuncioAcceso.texto}</span>
                    </p>

                    {cargandoAcceso ? (
                      <div className="text-center"><Spinner animation="border" aria-hidden="true" /></div>
                    ) : errorAcceso ? (
                      <Alert variant="danger" className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-0">
                        <span>No se pudo cargar el acceso de este dashboard.</span>
                        <Button ref={reintentarRef} size="sm" variant="outline-danger" onClick={reintentarAcceso}>Reintentar</Button>
                      </Alert>
                    ) : (
                      <>
                        <Form.Group className="mb-2" controlId="acceso-buscar-rol">
                          <Form.Label>Buscar rol</Form.Label>
                          <Form.Control
                            ref={buscadorRef}
                            type="search"
                            value={busquedaRol}
                            onChange={(e) => setBusquedaRol(e.target.value)}
                            onKeyDown={teclaEnBuscador}
                            placeholder="Escriba parte del nombre del rol"
                            autoComplete="off"
                            data-sin-descarte
                            disabled={guardando}
                          />
                        </Form.Group>

                        <p className="dashboard-permisos__resumen">
                          {totalPuedenVer === 0
                            ? 'Sin roles asignados: lo ve cualquiera con el permiso general de dashboards.'
                            : `${totalPuedenVer} ${totalPuedenVer === 1 ? 'rol puede' : 'roles pueden'} ver · ${totalPuedenEditar} ${totalPuedenEditar === 1 ? 'puede' : 'pueden'} editar`}
                        </p>

                        {rolesDisponibles.length === 0 ? (
                          <p className="dashboard-permisos__vacio mb-0">No hay roles registrados. Créelos en Configuración → Roles.</p>
                        ) : rolesFiltrados.length === 0 ? (
                          <p className="dashboard-permisos__vacio mb-0">
                            Ningún rol coincide con «{busquedaRol.trim()}».
                          </p>
                        ) : (
                          <div className="dashboard-permisos__lista">
                            <Table size="sm" className="mb-0 align-middle" aria-describedby="acceso-ayuda-reglas">
                              <caption className="visually-hidden">Acceso de cada rol a este dashboard</caption>
                              <thead>
                                <tr>
                                  <th scope="col">Rol</th>
                                  <th scope="col" className="dashboard-permisos__col-casilla">Ver</th>
                                  <th scope="col" className="dashboard-permisos__col-casilla">
                                    Editar<span className="d-none d-sm-inline"> (incluye ver)</span>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {rolesFiltrados.map((rol) => (
                                  <tr key={rol.id}>
                                    <th scope="row" className="fw-normal">{rol.name}</th>
                                    <td className="dashboard-permisos__col-casilla">
                                      <label className="dashboard-permisos__casilla" htmlFor={`acceso-ver-${rol.id}`}>
                                        <Form.Check.Input
                                          type="checkbox"
                                          id={`acceso-ver-${rol.id}`}
                                          checked={lectores.includes(rol.id) || editores.includes(rol.id)}
                                          onChange={(e) => marcarVer(rol.id, e.target.checked)}
                                          disabled={guardando}
                                        />
                                        <span className="visually-hidden">Ver: {rol.name}</span>
                                      </label>
                                    </td>
                                    <td className="dashboard-permisos__col-casilla">
                                      <label className="dashboard-permisos__casilla" htmlFor={`acceso-editar-${rol.id}`}>
                                        <Form.Check.Input
                                          type="checkbox"
                                          id={`acceso-editar-${rol.id}`}
                                          checked={editores.includes(rol.id)}
                                          onChange={(e) => marcarEditar(rol.id, e.target.checked)}
                                          disabled={guardando}
                                        />
                                        <span className="visually-hidden">Editar: {rol.name}</span>
                                      </label>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </Accordion.Body>
              </Accordion.Item>
            )}

            {puedeAdministrarAcceso && (
              <Accordion.Item eventKey="dueno">
                <Accordion.Header>Dueño del tablero</Accordion.Header>
                <Accordion.Body>
                  {cargandoAcceso ? (
                    <div className="text-center"><Spinner animation="border" aria-hidden="true" /><span className="visually-hidden">Cargando dueño…</span></div>
                  ) : errorAcceso ? (
                    // Sin el acceso cargado, «Sin dueño» no es el dueño real: no se ofrece el selector.
                    // Sin `role="alert"`: el fallo ya lo anuncia la alerta de Permisos.
                    <p className="dashboard-permisos__vacio mb-0">
                      No se pudo cargar el dueño. Use «Reintentar» en Permisos.
                    </p>
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
          <Button variant="primary" type="submit" disabled={guardando || accesoSinCargar}>
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

      {/* Una instancia por dashboard: cada uno abre con estado nuevo y una respuesta tardía del
          anterior no puede pisarlo. */}
      <ModalEditarDashboard
        key={dashboardAEditar?.dashboard_id || 'ninguno'}
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
