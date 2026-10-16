import api from './api'

export function obtenerLayout() {
  return api.get('/plantilla-base/layout').then((r) => r.data)
}

/** Igual que `dashboardLayoutService.guardarLayout`: el autor lo resuelve el backend. */
export function guardarLayout({ version, components }) {
  return api.put('/plantilla-base/layout', { version, components }).then((r) => r.data)
}

export function restablecer() {
  return api.post('/plantilla-base/reset').then((r) => r.data)
}
