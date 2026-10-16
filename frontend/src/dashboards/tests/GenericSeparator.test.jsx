import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import GenericSeparator from '../components/dashboard-generic/GenericSeparator'

describe('GenericSeparator', () => {
  it('sin título, dibuja una línea sola sin ninguna etiqueta', () => {
    const { container } = render(<GenericSeparator content={{ titulo: '' }} />)
    expect(container.querySelectorAll('hr')).toHaveLength(1)
  })

  it('sin content, dibuja una línea sola (mismo caso que título vacío)', () => {
    const { container } = render(<GenericSeparator content={undefined} />)
    expect(container.querySelectorAll('hr')).toHaveLength(1)
  })

  it('con título, lo muestra como etiqueta centrada entre dos líneas', () => {
    const { container } = render(<GenericSeparator content={{ titulo: 'Sección 2' }} />)
    expect(screen.getByText('Sección 2')).toBeInTheDocument()
    expect(container.querySelectorAll('hr')).toHaveLength(2)
  })

  it('un título solo con espacios se trata como vacío', () => {
    const { container } = render(<GenericSeparator content={{ titulo: '   ' }} />)
    expect(container.querySelectorAll('hr')).toHaveLength(1)
  })
})
