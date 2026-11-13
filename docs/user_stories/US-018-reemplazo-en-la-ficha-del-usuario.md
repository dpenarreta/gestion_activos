# Historia de Usuario: US-018 - Configurar en la ficha del usuario quién aprueba por esa persona mientras está ausente

- **ID:** US-018
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-13
- **Sprint / Módulo:** Configuración › Usuarios (`backend/apps/users`, `apps/organizacion/ausencia.py`; `frontend/src/pages/Admin/Users/`)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-2 (incluye las migraciones de permisos), DEV-4

---

### 1. Definición de la Historia
- **Como:** administrador con el permiso correspondiente (TI, o Gestión Humana si se le da).
- **Quiero:** elegir, desde la ficha de una persona, quién aprueba por ella mientras está ausente: su jefe inmediato u otra persona.
- **Para:** que sus aprobaciones no se queden detenidas cuando sale de vacaciones sin haberlo configurado ella misma.

Hasta ahora solo lo configuraba cada persona en «Chat › Mi estado» o al pedir un permiso (US-001).

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Ver la configuración**
  - **Dado que:** tengo `usuarios.ver`.
  - **Cuando:** abro la ficha de una persona en Configuración › Usuarios.
  - **Entonces:**
    - Veo la tarjeta «Mientras no está», con lo configurado en la empresa activa: su jefe inmediato (con el nombre) u otra persona.
    - Si hoy está ausente, veo «De vacaciones» o «Fuera de la oficina» con la fecha de regreso. Nunca el tipo de permiso.

- **CA-2 · Cambiarla**
  - **Dado que:** tengo `usuarios.reemplazo`.
  - **Cuando:** elijo «Su jefe inmediato» u «Otra persona» y guardo.
  - **Entonces:**
    - Se guarda como si la persona lo hubiera elegido: es la misma configuración de «Mi estado», y ella la ve y la puede cambiar.
    - La persona recibe un aviso en la campana con quién lo cambió y a quién eligió.
    - Queda en la auditoría: quién, a quién, valor anterior y nuevo.
    - Si hoy está ausente, sus aprobaciones pendientes pasan enseguida al nuevo reemplazo, con la constancia de siempre en el historial.

- **CA-3 · Validaciones y límites**
  - **Entonces:**
    - Con «Otra persona», hay que elegirla. No puede ser la misma persona y debe tener una cuenta activa en la empresa. Si no, 400 en `persona_id`.
    - Sin empresa activa, o si la persona no es de la empresa activa, 400 con un mensaje claro.
    - Solo un superusuario configura el reemplazo de otro superusuario. Los demás reciben 403.
    - Sin `usuarios.reemplazo`, la API responde 403 y la tarjeta se ve solo para leer.

- **CA-4 · Permisos (todo nace con los suyos)**
  - **Entonces:**
    - Existe `usuarios.reemplazo` («Configurar quién aprueba por otra persona mientras está ausente»).
    - La migración lo da a «Administrador» y «Superusuario». Se puede dar a otros roles, como los de Gestión Humana, desde Roles.

---

### 3. Alcance Técnico por Capa
| Capa | Entregables |
|---|---|
| Backend | Acción `GET/PATCH /api/v1/admin/users/<id>/reemplazo/` en el viewset de usuarios: lectura con `usuarios.ver`, escritura con `usuarios.reemplazo`. `ausencia.guardar_reemplazo(..., por_otra=True)` con los mensajes en tercera persona. Campana a la persona, auditoría `usuarios.reemplazo.configurado`, reasignación de lo pendiente si está ausente. Permiso en el catálogo, migraciones permissions 0067 y roles 0053. Pruebas. |
| Web | Tarjeta «Mientras no está» en la ficha (`ReemplazoDeLaCuenta.jsx`). Reutiliza `useReemplazoEnAusencia`/`ReemplazoEnAusencia` con su servicio y sus textos en tercera persona. Solo lectura sin el permiso. Pruebas. |

**Fuera de alcance:**
- Fechas propias del reemplazo: vale para todas sus ausencias, como en US-001.
- Marcar las vacaciones de otra persona: eso es Solicitud de permisos o Ausencias.

---

### 4. Contrato
| Operación | Ruta | Acceso | Entrada | Salida | Errores |
|---|---|---|---|---|---|
| Ver | `GET /api/v1/admin/users/<id>/reemplazo/` | `usuarios.ver` | — | `{modo, persona, jefe, ausencia}`. `ausencia` es `{clave, texto, hasta}` o null | 400 sin empresa o fuera de la empresa; 404 fuera de su alcance |
| Guardar | `PATCH /api/v1/admin/users/<id>/reemplazo/` | `usuarios.reemplazo` | `{modo, persona_id?}` | Igual que GET | 400 `persona_id` o `modo`; 403 sobre un superusuario sin serlo |

---

### 5. Decisiones Técnicas y Supuestos
- **Decisión del usuario (13/11/2026):** «agrega la opción en la ficha del usuario».
- **Misma configuración:** se guarda en `DatosDeContacto` de la empresa activa, como «Mi estado». No hay una segunda configuración que pueda contradecirla.
- **Permiso propio:** `usuarios.reemplazo`, regla «todo lo nuevo nace con sus permisos».
- **El buscador de personas** usa el directorio del chat, que deja fuera a quien consulta. Por eso un administrador no puede elegirse a sí mismo desde aquí. Supuesto aceptado, igual que en «Mi estado».

---

### 6. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-13
- **Criterios de aceptación:** CA-1 ✅ · CA-2 ✅ · CA-3 ✅ · CA-4 ✅
- **Archivos principales:**
  - Backend: `apps/users/{views,services,permissions}.py`, `apps/organizacion/ausencia.py` (`por_otra`), `apps/permissions/catalog.py`, migraciones permissions 0067 y roles 0053.
  - Web: `pages/Admin/Users/ReemplazoDeLaCuenta.jsx`, `UserForm.jsx`, `components/common/Ausencia/ReemplazoEnAusencia.jsx` (servicio y textos parametrizados), `api/adminUsersService.js`.
- **Cambio sobre el diseño inicial:** la acción usa `PATCH`, porque el viewset de usuarios no admite `PUT` y abrirlo habilitaría también la edición completa por PUT. Además, la reasignación de lo pendiente se hace en el acto, como al guardar «Mi estado», no al confirmar la transacción.
- **Verificación ejecutada:**
  - pytest de users, organizacion, roles, permissions, licencias y chat: 622 pasan.
  - Vitest completo: 3313 de 3313.
- **Pendientes:**
  - Revisión visual en vivo de la tarjeta: la sesión local se cerró al reiniciar el backend.
  - Desplegar con `-Migrar`.
