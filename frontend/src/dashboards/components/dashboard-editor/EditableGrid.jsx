import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import ComponentWrapper from './ComponentWrapper'
import { ZONAS_PLANTILLA } from '../../utils/plantillaSlots'

const IDS_CON_ZONA = ZONAS_PLANTILLA.flatMap((zona) => zona.ids)

// A qué zona pertenece cada `component_id` de la plantilla fija (los que no están en ninguna caen
// en 'sin-zona', salvo que sean de la Zona Personal — ver `zonaDe` más abajo) — usado para
// bloquear el arrastre entre zonas: KPIs, gráficos y tablas no se pueden mezclar.
const ZONA_DE = Object.fromEntries(IDS_CON_ZONA.map((id) => [
  id, ZONAS_PLANTILLA.find((zona) => zona.ids.includes(id)).id,
]))

/** A diferencia de `ZONA_DE` (estático, solo la plantilla fija), la Zona Personal es dinámica:
 * cualquier componente con `config.zona === 'personal'` (agregado desde "Agregar a Zona
 * Personal") — `personalIds` se recalcula en cada render, a partir de los componentes actuales,
 * para bloquear el arrastre cruzado hacia/desde ella igual que entre las 5 zonas de plantilla. */
function zonaDe(componentId, personalIds) {
  if (personalIds.has(componentId)) return 'personal'
  return ZONA_DE[componentId] ?? 'sin-zona'
}

/**
 * Un único contenedor flex-wrap: cada componente reserva `width/12` del ancho. No hay
 * coordenadas fila/columna que mantener a mano, así que nunca hay superposición ni huecos que
 * reorganizar (sección 9) — el propio `flex-wrap` acomoda todo automáticamente al reordenar,
 * ocultar o cambiar de ancho. En pantallas angostas cada tarjeta puede forzar 100% por CSS
 * (sección 21) sin tocar el modelo de datos.
 */
export default function EditableGrid({
  componentes, registro, modoEdicion, vistaPrevia, seleccionado,
  onSeleccionar, onMover, onOcultar, onMostrar, onEliminar, onReordenar, permiteEstilo, permiteEliminar, esSuperusuario,
  estructuraBloqueada = false,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ordenados = [...componentes].sort((a, b) => a.order - b.order)
  const visibles = ordenados.filter((c) => c.is_visible)
  const ids = ordenados.map((c) => c.component_id)
  const personalIds = new Set(componentes.filter((c) => c.config?.zona === 'personal').map((c) => c.component_id))

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    // Bloqueado: no se permite soltar un componente en la zona de otro tipo (KPIs, gráfico
    // principal, gráficos de apoyo, tabla principal, tablas de apoyo, Zona Personal son
    // compartimentos estancos). Al no llamar a onReordenar, el componente vuelve visualmente a
    // su posición.
    if (zonaDe(active.id, personalIds) !== zonaDe(over.id, personalIds)) return
    const desde = ids.indexOf(active.id)
    const hasta = ids.indexOf(over.id)
    onReordenar(arrayMove(ids, desde, hasta))
  }

  if (!modoEdicion || vistaPrevia) {
    return (
      <div className="dashboard-grid d-flex flex-wrap">
        {visibles.map((c) => {
          const definicion = registro[c.component_id]
          if (!definicion) return null
          const anchoPorcentaje = `${(c.width / 12) * 100}%`
          return (
            // El ancho viaja como variable CSS y no como `flex`/`max-width` inline: un estilo
            // inline le gana a cualquier media query, y es lo que impedía que los paneles se
            // apilaran en pantallas angostas (ver `.dashboard-grid__celda` en dashboard.css).
            <div
              key={c.component_id}
              className="dashboard-grid__celda"
              data-ancho={c.width}
              style={{ '--ancho-panel': anchoPorcentaje }}
            >
              {definicion.render(c)}
            </div>
          )
        })}
      </div>
    )
  }

  // Agrupados por zona (sección 9) para que, en modo edición, se vea de un vistazo dónde va
  // cada bloque — cada componente cae siempre en su zona por `component_id`, sin importar el
  // orden dentro de ella, así que el recuadro punteado nunca "pierde" un componente al
  // reordenar. Los que no pertenecen a ninguna zona conocida (posiciones ad-hoc) se listan
  // aparte, sin recuadro, para no ocultar nada.
  const grupos = ZONAS_PLANTILLA
    .map((zona) => ({ ...zona, items: ordenados.filter((c) => zona.ids.includes(c.component_id)) }))
    .filter((zona) => zona.items.length > 0)
  // La Zona Personal (`config.zona === 'personal'`) es dinámica y siempre va AL FINAL de todas
  // las zonas de la plantilla fija, y solo aparece si tiene 1+ componentes — sin ella, ni
  // siquiera queda un recuadro vacío (sección "Zona Personal").
  const personales = ordenados.filter((c) => personalIds.has(c.component_id))
  const gruposFinal = personales.length > 0
    ? [...grupos, { id: 'personal', etiqueta: 'Zona personal', items: personales }]
    : grupos
  const sinZona = ordenados.filter((c) => !IDS_CON_ZONA.includes(c.component_id) && !personalIds.has(c.component_id))

  const renderGrupo = (items) => items.map((c, i) => {
    const definicion = registro[c.component_id]
    if (!definicion) return null
    return (
      <ComponentWrapper
        key={c.component_id}
        componente={{ ...c, render: () => definicion.render(c) }}
        esPrimero={i === 0}
        esUltimo={i === items.length - 1}
        seleccionado={seleccionado === c.component_id}
        onSeleccionar={onSeleccionar}
        onMover={onMover}
        onOcultar={onOcultar}
        onMostrar={onMostrar}
        onEliminar={onEliminar}
        permiteEstilo={permiteEstilo}
        permiteEliminar={permiteEliminar}
        esSuperusuario={esSuperusuario}
        estructuraBloqueada={estructuraBloqueada}
      />
    )
  })

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      {gruposFinal.map((zona) => (
        <div key={zona.id} className="mb-3">
          <div className="mz-edit-zone__label">{zona.etiqueta}</div>
          {/* SortableContext por zona (no uno global): así el reacomodo animado durante el
              arrastre solo involucra a los componentes de la misma zona, nunca sugiere que se
              pueda soltar uno en la zona vecina. */}
          <SortableContext items={zona.items.map((c) => c.component_id)} strategy={rectSortingStrategy}>
            <div className="dashboard-grid mz-edit-zone d-flex flex-wrap" role="list" aria-label={zona.etiqueta}>
              {renderGrupo(zona.items)}
            </div>
          </SortableContext>
        </div>
      ))}

      {sinZona.length > 0 && (
        <SortableContext items={sinZona.map((c) => c.component_id)} strategy={rectSortingStrategy}>
          <div className="dashboard-grid d-flex flex-wrap" role="list" aria-label="Otros componentes">
            {renderGrupo(sinZona)}
          </div>
        </SortableContext>
      )}
    </DndContext>
  )
}
