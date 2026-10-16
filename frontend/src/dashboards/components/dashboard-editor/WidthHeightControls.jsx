import { Form } from 'react-bootstrap'

const ANCHOS = [
  { valor: 2, etiqueta: '2 columnas — 17%' },
  { valor: 3, etiqueta: '3 columnas — 25%' },
  { valor: 4, etiqueta: '4 columnas — 33%' },
  { valor: 6, etiqueta: '6 columnas — 50%' },
  { valor: 8, etiqueta: '8 columnas — 67%' },
  { valor: 9, etiqueta: '9 columnas — 75%' },
  { valor: 12, etiqueta: '12 columnas — 100%' },
]

const ALTURAS = [
  { valor: 240, etiqueta: 'Pequeño (240px)' },
  { valor: 400, etiqueta: 'Mediano (400px)' },
  { valor: 600, etiqueta: 'Grande (600px)' },
  { valor: 'personalizado', etiqueta: 'Personalizado' },
]

/**
 * Ancho por selector de columnas (1-12) y alto por presets (sección 11). Se descartó el
 * arrastre libre de bordes en píxeles: es mucho más accesible y evita superposiciones por
 * construcción (el contenedor usa flex-wrap sobre estos anchos discretos).
 */
export default function WidthHeightControls({ width, height, onCambiarAncho, onCambiarAlto, disabled }) {
  const alturaPreset = ALTURAS.some((a) => a.valor === height) ? height : 'personalizado'

  return (
    <div className="d-flex gap-2 align-items-end flex-wrap">
      <Form.Group controlId="control-ancho">
        <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Ancho</Form.Label>
        <Form.Select size="sm" value={width} onChange={(e) => onCambiarAncho(Number(e.target.value))} disabled={disabled}>
          {ANCHOS.map((a) => <option key={a.valor} value={a.valor}>{a.etiqueta}</option>)}
        </Form.Select>
      </Form.Group>
      <Form.Group controlId="control-alto">
        <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Alto</Form.Label>
        <Form.Select
          size="sm"
          value={alturaPreset}
          onChange={(e) => {
            const valor = e.target.value
            if (valor !== 'personalizado') onCambiarAlto(Number(valor))
          }}
          disabled={disabled}
        >
          {ALTURAS.map((a) => <option key={a.etiqueta} value={a.valor}>{a.etiqueta}</option>)}
        </Form.Select>
      </Form.Group>
      {alturaPreset === 'personalizado' && (
        <Form.Group controlId="control-alto-personalizado">
          <Form.Label className="mb-1" style={{ fontSize: '0.8rem' }}>Alto personalizado (px)</Form.Label>
          <Form.Control
            type="number"
            size="sm"
            min={60}
            max={1200}
            value={height}
            onChange={(e) => onCambiarAlto(Math.min(1200, Math.max(60, Number(e.target.value) || 60)))}
            disabled={disabled}
          />
        </Form.Group>
      )}
    </div>
  )
}
