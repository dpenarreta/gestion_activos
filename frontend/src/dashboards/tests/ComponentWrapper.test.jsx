import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import ComponentWrapper from '../components/dashboard-editor/ComponentWrapper'

function componenteDePrueba(extra = {}) {
  return {
    component_id: 'kpi-cartera-vencida', width: 2, height: 180, is_visible: true,
    render: () => <div>Contenido del componente</div>,
    ...extra,
  }
}

function renderWrapper(overrides = {}) {
  const props = {
    componente: componenteDePrueba(),
    esPrimero: false,
    esUltimo: false,
    seleccionado: false,
    onSeleccionar: vi.fn(),
    onMover: vi.fn(),
    onOcultar: vi.fn(),
    onMostrar: vi.fn(),
    onEliminar: vi.fn(),
    permiteEstilo: true,
    permiteEliminar: true,
    ...overrides,
  }
  const utils = render(
    <DndContext>
      <SortableContext items={[props.componente.component_id]}>
        <ComponentWrapper {...props} />
      </SortableContext>
    </DndContext>,
  )
  return { props, ...utils }
}

describe('ComponentWrapper', () => {
  it('muestra el contenido del componente cuando es visible', () => {
    renderWrapper()
    expect(screen.getByText('Contenido del componente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument()
  })

  it('muestra el marcador de "oculto" y el botón Mostrar cuando is_visible es false', () => {
    renderWrapper({ componente: componenteDePrueba({ is_visible: false }) })
    expect(screen.getByText('Componente oculto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mostrar' })).toBeInTheDocument()
    expect(screen.queryByText('Contenido del componente')).not.toBeInTheDocument()
  })

  it('Ocultar invoca onOcultar con el component_id', async () => {
    const { props } = renderWrapper()
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar' }))
    expect(props.onOcultar).toHaveBeenCalledWith('kpi-cartera-vencida')
  })

  it('Mostrar invoca onMostrar con el component_id', async () => {
    const { props } = renderWrapper({ componente: componenteDePrueba({ is_visible: false }) })
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar' }))
    expect(props.onMostrar).toHaveBeenCalledWith('kpi-cartera-vencida')
  })

  it('el botón de configurar (engranaje) invoca onSeleccionar cuando permiteEstilo es true', async () => {
    const { props } = renderWrapper({ permiteEstilo: true })
    await userEvent.click(screen.getByRole('button', { name: 'Configurar kpi-cartera-vencida' }))
    expect(props.onSeleccionar).toHaveBeenCalledWith('kpi-cartera-vencida')
  })

  it('sin permiso de estilo (permiteEstilo=false) no muestra el botón de configurar', () => {
    renderWrapper({ permiteEstilo: false })
    expect(screen.queryByRole('button', { name: 'Configurar kpi-cartera-vencida' })).not.toBeInTheDocument()
  })

  it('los botones de mover llaman a onMover con el component_id y la dirección', async () => {
    const { props } = renderWrapper()
    await userEvent.click(screen.getByRole('button', { name: 'Mover abajo' }))
    expect(props.onMover).toHaveBeenCalledWith('kpi-cartera-vencida', 'abajo')
  })

  it('sin permiso de eliminar (permiteEliminar=false) no muestra el botón Eliminar', () => {
    renderWrapper({ permiteEliminar: false })
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
  })

  it('Eliminar pide confirmación antes de invocar onEliminar', async () => {
    const { props } = renderWrapper()
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }))

    expect(props.onEliminar).not.toHaveBeenCalled()
    expect(screen.getByText('¿Eliminar?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Sí' }))
    expect(props.onEliminar).toHaveBeenCalledWith('kpi-cartera-vencida')
  })

  it('"No" en la confirmación de eliminar cancela sin invocar onEliminar', async () => {
    const { props } = renderWrapper()
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    await userEvent.click(screen.getByRole('button', { name: 'No' }))

    expect(props.onEliminar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
  })

  describe('componente bloqueado (config.bloqueado)', () => {
    function componenteBloqueado(extra = {}) {
      return componenteDePrueba({ config: { bloqueado: true }, ...extra })
    }

    it('sin superusuario, la manija de arrastre queda deshabilitada', () => {
      renderWrapper({ componente: componenteBloqueado() })
      expect(screen.getByRole('button', { name: 'Arrastrar para reordenar kpi-cartera-vencida' })).toBeDisabled()
    })

    it('sin superusuario, no muestra "Ocultar" ni "Eliminar"', () => {
      renderWrapper({ componente: componenteBloqueado() })
      expect(screen.queryByRole('button', { name: 'Ocultar' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
    })

    it('sin superusuario, los botones de mover quedan deshabilitados', () => {
      renderWrapper({ componente: componenteBloqueado() })
      expect(screen.getByRole('button', { name: 'Mover abajo' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Mover arriba' })).toBeDisabled()
    })

    it('con superusuario, se comporta como un componente sin bloquear', () => {
      const { props } = renderWrapper({ componente: componenteBloqueado(), esSuperusuario: true })
      expect(screen.getByRole('button', { name: 'Arrastrar para reordenar kpi-cartera-vencida' })).not.toBeDisabled()
      expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Mover abajo' })).not.toBeDisabled()
      expect(props.onOcultar).not.toHaveBeenCalled()
    })
  })
})
