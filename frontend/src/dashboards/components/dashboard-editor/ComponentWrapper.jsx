import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from 'react-bootstrap'
import MoveButtons from './MoveButtons'

/** Nombre legible de un componente para los nombres accesibles de la barra de edición —
 * auditoría UX/UI, fase 3, 28/10/2026: antes se usaba el `component_id` técnico
 * («kpi-cartera-vencida»), que no coincide con nada de lo que se ve en pantalla. */
export function nombreDelComponente(componente) {
  return componente?.content?.titulo || componente?.content?.texto || 'Componente sin título'
}

/**
 * Chrome de edición alrededor de cualquier componente del dashboard (sección 7): borde visual,
 * manija de arrastre (dnd-kit, con soporte de teclado), engranaje para abrir el panel de
 * propiedades, ocultar/mostrar, eliminar (con confirmación in-line, ya que a diferencia de
 * ocultar no es reversible) y los botones de mover como alternativa accesible al arrastre.
 */
export default function ComponentWrapper({
  componente, esPrimero, esUltimo, seleccionado,
  onSeleccionar, onMover, onOcultar, onMostrar, onEliminar, permiteEstilo, permiteEliminar, esSuperusuario,
  estructuraBloqueada = false,
}) {
  // Dos bloqueos distintos, mismo efecto visual. `config.bloqueado` marca componentes sembrados
  // como estructura fija de un dashboard puntual; `estructuraBloqueada` congela el dashboard
  // entero (`Dashboard.estructura_bloqueada`). Un superusuario ve los controles habilitados en
  // ambos casos: del primero está exento, y del segundo puede salir confirmando su contraseña al
  // guardar, así que deshabilitárselos acá le escondería una salida que sí tiene.
  //
  // La protección REAL está en el backend (`services/dashboard_layout.py::validar_componentes`);
  // esto es solo para no invitar a intentar algo que el servidor va a rechazar.
  const bloqueado = (Boolean(componente.config?.bloqueado) || estructuraBloqueada) && !esSuperusuario
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: componente.component_id, disabled: bloqueado,
  })
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : componente.is_visible ? 1 : 0.5,
  }

  const anchoPorcentaje = `${(componente.width / 12) * 100}%`
  const nombre = nombreDelComponente(componente)

  return (
    // Mismo criterio que `EditableGrid`: el ancho va como variable CSS para que las media
    // queries puedan apilarlo en pantallas angostas.
    <div
      className="dashboard-grid__celda"
      data-ancho={componente.width}
      style={{ ...style, '--ancho-panel': anchoPorcentaje }}
      ref={setNodeRef}
    >
      <div
        className={`mz-edit-item h-100 ${seleccionado ? 'is-selected' : ''}`}
        role="group"
        aria-label={`Componente "${nombre}", editable`}
      >
        {/* Barra de acciones de la Matriz: botones de solo ícono (`mz-icon-btn`), con el nombre en
            `aria-label` y `title` para lectores de pantalla y al pasar el cursor. */}
        <div className="mz-edit-bar">
          <button
            type="button"
            className="mz-icon-btn mz-edit-grip"
            aria-label={`Arrastrar para reordenar "${nombre}"`}
            title={bloqueado ? 'Componente bloqueado: no se puede reordenar' : 'Arrastrar para reordenar'}
            disabled={bloqueado}
            {...attributes}
            {...listeners}
          >
            <i className="bi bi-grip-vertical" aria-hidden="true"></i>
          </button>
          <MoveButtons
            onMover={(direccion) => onMover(componente.component_id, direccion)}
            deshabilitarArriba={esPrimero || bloqueado}
            deshabilitarAbajo={esUltimo || bloqueado}
            nombre={nombre}
          />
          <div className="mz-edit-bar__acciones">
            {permiteEstilo && (
              <button
                type="button"
                className={`mz-icon-btn ${seleccionado ? 'is-active' : ''}`}
                onClick={() => onSeleccionar(componente.component_id)}
                aria-label={`Configurar "${nombre}"`}
                title="Configurar (título, descripción, colores)"
              >
                <i className="bi bi-gear" aria-hidden="true"></i>
              </button>
            )}
            {!bloqueado && (componente.is_visible ? (
              <button type="button" className="mz-icon-btn" onClick={() => onOcultar(componente.component_id)} aria-label={`Ocultar "${nombre}"`} title="Ocultar">
                <i className="bi bi-eye-slash" aria-hidden="true"></i>
              </button>
            ) : (
              <button type="button" className="mz-icon-btn is-active" onClick={() => onMostrar(componente.component_id)} aria-label={`Mostrar "${nombre}"`} title="Mostrar">
                <i className="bi bi-eye" aria-hidden="true"></i>
              </button>
            ))}
            {permiteEliminar && !bloqueado && (
              confirmandoEliminar ? (
                <div className="mz-edit-confirmar" role="group" aria-label={`¿Eliminar "${nombre}"?`}>
                  <span>¿Eliminar?</span>
                  <Button size="sm" variant="danger" onClick={() => onEliminar(componente.component_id)}>Sí</Button>
                  <Button size="sm" variant="outline-secondary" onClick={() => setConfirmandoEliminar(false)}>No</Button>
                </div>
              ) : (
                <button
                  type="button" className="mz-icon-btn mz-icon-btn--peligro"
                  onClick={() => setConfirmandoEliminar(true)}
                  aria-label={`Eliminar "${nombre}"`} title="Eliminar (no se puede deshacer)"
                >
                  <i className="bi bi-trash" aria-hidden="true"></i>
                </button>
              )
            )}
          </div>
        </div>

        {componente.is_visible ? (
          // Se desactivan las interacciones internas (clics de drill-down, botones propios del
          // gráfico) mientras se está organizando el layout, para que no interfieran con el
          // arrastre (sección 7). En "Vista previa" el chrome de edición desaparece y todo
          // vuelve a ser interactivo con normalidad.
          <div style={{ pointerEvents: 'none' }}>{componente.render()}</div>
        ) : (
          <div className="mz-edit-oculto"><i className="bi bi-eye-slash" aria-hidden="true"></i> Componente oculto</div>
        )}
      </div>
    </div>
  )
}
