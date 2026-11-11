# Historia de Usuario: US-001 - Ausencias visibles y reemplazo en las aprobaciones

- **ID:** US-001
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-11
- **Sprint / Módulo:** Organización · Solicitud de permisos · Solicitud de proyectos · Mesa de ayuda · Chat
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-3, DEV-2, DEV-4

---

### 1. Definición de la Historia
- **Como:** persona que aprueba solicitudes (jefe, responsable de área) y que sale de vacaciones, tiene un permiso aprobado o marca que está fuera de la oficina.
- **Quiero:** que quien me escribe por el chat o espera mi aprobación vea que estoy ausente y hasta cuándo, y que las aprobaciones que me toquen pasen solas a mi jefe o a la persona que yo elija.
- **Para:** que las solicitudes no se queden detenidas mientras no estoy y que nadie espere respuesta de quien no puede darla.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

**Ausencia de una persona** (en adelante, «ausente»). Una persona está ausente en una fecha si se cumple cualquiera de estas condiciones:
1. Tiene un permiso o vacaciones **aprobados** que cubren el día completo (`ausencias.LeaveRecord`, `is_full_day`).
2. Su estado de chat vigente es «De vacaciones».
3. Su estado de chat vigente es el nuevo «Fuera de la oficina».

- **CA-1 · Nuevo estado «Fuera de la oficina» en el chat**
  - **Dado que:** abro «Mi estado» en el chat.
  - **Cuando:** elijo «Fuera de la oficina», con fecha de regreso y un mensaje opcional.
  - **Entonces:** el estado queda guardado y vigente hasta esa fecha. Quien me escribe ve «Fuera de la oficina hasta el dd/mm» y mi mensaje.

- **CA-2 · Los permisos aprobados se reflejan solos en el chat**
  - **Dado que:** tengo aprobado un permiso o vacaciones de día completo para hoy, sin haber cambiado mi estado de chat.
  - **Cuando:** alguien abre un chat directo conmigo o me escribe en un grupo.
  - **Entonces:**
    - Si es vacaciones, ve «De vacaciones hasta el dd/mm».
    - Si es cualquier otro tipo de permiso, ve «Fuera de la oficina hasta el dd/mm».
    - El tipo de permiso (médico, personal) **nunca** se muestra a terceros.

- **CA-3 · Elegir el reemplazo para las aprobaciones**
  - **Dado que:** estoy en «Mi estado» del chat (vacaciones o fuera de la oficina) o pidiendo un permiso o vacaciones.
  - **Cuando:** en el bloque «Mientras usted no está» respondo «¿Quién aprueba por usted?» con «Mi jefe inmediato», la opción por defecto, o con «Otra persona», que busco por nombre. El texto cambió el 11/11/2026 por la auditoría UX, que pidió evitar la redundancia.
  - **Entonces:**
    - La elección se guarda como mi configuración en la empresa actual y vale para toda ausencia mía.
    - Se muestra quién es hoy mi jefe inmediato.
    - No puedo elegirme a mí mismo.

- **CA-4 · Las aprobaciones nuevas pasan al reemplazo**
  - **Dado que:** estoy ausente y llega una solicitud de permiso, de proyecto o una aprobación de la Mesa de ayuda que me tocaría aprobar.
  - **Cuando:** el sistema asigna los aprobadores.
  - **Entonces:**
    - Se asigna a mi reemplazo en lugar de a mí.
    - El reemplazo recibe la notificación de siempre: campana y, en la Mesa de ayuda, el correo.
    - El historial dice «Escalada a {reemplazo} por ausencia de {yo}».

- **CA-5 · Lo que ya tenía pendiente también pasa**
  - **Dado que:** tengo aprobaciones pendientes y empieza mi ausencia, ya sea porque llega la fecha de mis vacaciones aprobadas o porque marco mi estado.
  - **Cuando:** el sistema revisa las ausencias. Lo hace al cambiar el estado, al aprobarse el permiso si empieza hoy, y periódicamente con la tarea programada.
  - **Entonces:**
    - Mis aprobaciones pendientes de los tres flujos pasan a mi reemplazo, con la misma constancia en el historial.
    - Al volver, lo ya reasignado se queda con el reemplazo.

- **CA-6 · Cadena de reemplazos y casos límite**
  - **Dado que:** mi reemplazo también está ausente, o yo no tengo jefe ni reemplazo, o mi reemplazo es el propio solicitante.
  - **Cuando:** se resuelve a quién reasignar.
  - **Entonces:**
    - Se sigue la cadena: el reemplazo de mi reemplazo, o el jefe de mi jefe. Hay un tope de 5 saltos y nunca se vuelve a alguien ya visitado.
    - Se salta al solicitante y a quien ya aprobó ese paso. En permisos y proyectos se respetan las mismas exclusiones que `escalar`.
    - Si no queda nadie, la aprobación se queda conmigo, como hoy.

- **CA-7 · Se ve en la solicitud que el aprobador está ausente**
  - **Dado que:** veo una solicitud (de permiso, de proyecto o de la Mesa de ayuda) cuyo aprobador pendiente está ausente. Puede pasar con solicitudes ya reasignadas a mano o si aún no ha corrido la revisión.
  - **Cuando:** abro la lista o el detalle.
  - **Entonces:**
    - Junto a su nombre aparece «De vacaciones» o «Fuera de la oficina», con la fecha de regreso y su reemplazo.
    - En el historial de una solicitud reasignada se ve el motivo.

- **CA-8 · Privacidad**
  - **Dado que:** cualquier tercero ve mi ausencia.
  - **Cuando:** se muestra en el chat o en una solicitud.
  - **Entonces:**
    - Solo se muestran tres datos: si es vacaciones o «fuera de la oficina», la fecha de regreso y el reemplazo. Nunca el tipo de permiso ni el motivo.
    - La configuración del reemplazo y el mensaje de fuera de la oficina aparecen en la exportación de «Mis datos».

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Datos | DEV-3 | `EstadoChat`: estado `fuera_oficina`, con `hasta` y `mensaje` reutilizados o propios. `DatosDeContacto`: `reemplazo_modo` (`jefe` / `persona`, por defecto `jefe`) y `reemplazo` (FK a User, nulo). Migraciones aplicadas en local. |
| Backend | DEV-2 | Servicio `apps/organizacion/ausencia.py` con `ausencia_de(usuarios, fecha)` (en lote, sin N+1), `reemplazo_para(usuario, excluir)` (cadena con tope) y `reasignar_pendientes(usuario)`. Enganche en `licencias.services._asignar`, `proyectos.services._asignar` y `soporte.services._pedir_aprobaciones`. Reasignación de pendientes al guardar el estado, al aprobarse un permiso que empieza hoy y en un comando de gestión que corre la tarea programada. `chat.estados.vigente` también considera los permisos aprobados. Campo `ausencia` en los aprobadores serializados de los tres flujos. Endpoint para leer y guardar el reemplazo. Exportación LOPDP. Pruebas. |
| Web | DEV-4 | «Fuera de la oficina» en `MiEstado.jsx`. Pregunta del reemplazo en `MiEstado` y en el formulario de solicitud de permiso. Etiqueta de ausencia junto al aprobador en `SolicitudPermisosPage`, `SolicitudProyectosPage` y `AprobacionesPage`. Textos del chat. Pruebas. |

**Fuera de alcance:**
- Respuesta automática publicada como mensaje en la conversación: se muestra el aviso, no se responde por la persona.
- Devolver al ausente lo reasignado cuando regresa.
- Ausencias por horas (no reasignan).
- Aprobaciones de compras (`solicitudes`) y de la Matriz de obligaciones, que tiene su propio suplente.

---

### 4. Contrato

| Operación | Ruta / Modelo / Acción | Acceso | Entrada | Salida | Errores |
|---|---|---|---|---|---|
| Leer mi reemplazo | `GET /api/v1/organizacion/mi-reemplazo/` | Autenticado | — | `{modo: "jefe"\|"persona", persona: {id, nombre}\|null, jefe: {id, nombre}\|null}` | — |
| Guardar mi reemplazo | `PUT /api/v1/organizacion/mi-reemplazo/` | Autenticado | `{modo, persona_id?}` | Igual que GET | 400 `persona_id` obligatorio si `modo=persona`; no puede ser uno mismo; debe ser miembro activo de la empresa |
| Buscar personas | Se reutiliza el buscador de personas existente | — | — | — | — |
| Estado de chat | `PUT /api/v1/chat/mi-estado/` (existente) | Autenticado | `estado: "fuera_oficina"`, `hasta`, `mensaje` | Igual que hoy | 400 sin `hasta` o con `hasta` en el pasado |
| Estado vigente | `chat.estados.vigente` / presencia (existente) | — | — | `clave` admite `fuera_oficina`; con un permiso aprobado, `vacaciones` o `fuera_oficina` y `hasta` = último día | — |
| Ausencia de un aprobador | `pendiente_de[]` en permisos y proyectos; `aprobador` en Mesa de ayuda | Lo que ya ve cada quien | — | Cada persona añade `ausencia: {clave: "vacaciones"\|"fuera_oficina", texto, hasta, reemplazo: {id, nombre}\|null}\|null` | — |
| Historial | `AccionSolicitud` (`ESCALADA`) en permisos y proyectos; equivalente en Mesa de ayuda | — | — | Comentario «Escalada a X por ausencia de Y» | — |
| Revisión periódica | `manage.py reasignar_por_ausencia` | Tarea programada | — | Cuántas reasignó | — |

---

### 5. Decisiones Técnicas y Supuestos
- **Decisiones del usuario (11/11/2026):**
  - Las aprobaciones pasan solas al reemplazo.
  - Elige la persona que se ausenta: su jefe inmediato por defecto, u otra persona.
  - Aplica a permisos y vacaciones, proyectos y Mesa de ayuda.
  - A terceros se les muestra «De vacaciones» o «Fuera de la oficina», nunca el tipo de permiso (regla LOPDP de `ausencias/access.py`).
- **Configuración del reemplazo:** se guarda una por persona y empresa, en `DatosDeContacto`, porque el jefe depende de la empresa. `EstadoChat` es global y no sirve para esto.
- **Jefe inmediato:** se resuelve con `licencias.services.jefes_de`, el mismo que usan los flujos de permisos. En la Mesa de ayuda, el reemplazo de un responsable de área se resuelve con la misma regla, sobre su cargo.
- **Ausencias que cuentan:** solo las de día completo. Un permiso por horas no reasigna, porque la persona vuelve el mismo día.
- **Revisión periódica:** la tarea programada de respaldo, que corre cada 5 minutos en Windows y ya ejecuta la Matriz, llama al comando. El comando no reasigna dos veces lo mismo.
- **Lo reasignado no vuelve:** al regresar, lo que pasó al reemplazo se queda con él. Es lo más simple y evita que una aprobación cambie de manos dos veces.

---

### 6. Registro de Cierre

- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-11
- **QA-FUNC:** 🟡 Aprobado con observaciones · **QA-TECH:** 🟡 Aprobado con observaciones (ronda 2; la 1 rechazó por 3 P2 de concurrencia y rendimiento, corregidos) · **QA-UX:** 🟢 sin Altos en la ronda 2 (la 1 tuvo 3 Altos, corregidos)
- **Criterios de aceptación:** CA-1 ✅, CA-2 ✅, CA-3 ✅, CA-4 ✅, CA-5 ✅, CA-6 ✅, CA-7 ✅ (Mesa de ayuda: solo en el detalle del equipo), CA-8 ✅
- **Archivos principales:** `backend/apps/organizacion/ausencia.py`, `organizacion/management/commands/reasignar_por_ausencia.py`, `chat/estados.py`, `licencias/services.py`, `proyectos/services.py`, `soporte/services.py`, `frontend/src/components/common/Ausencia/`, `frontend/src/components/admin/Chat/MiEstado.jsx`, `Presencia.jsx`
- **Verificación ejecutada:** `pytest` de organizacion, chat, licencias, proyectos, soporte, ausencias, privacidad, nomina, core y authentication → 1100 passed (12 min 42 s); `makemigrations --check` → sin cambios; `vitest run` → 2978 passed; eslint sin errores; `vite build` correcto.
- **Pendientes:** tarjetas móviles en Solicitud de proyectos; mostrar la pregunta del reemplazo solo a quien aprueba; ausencia del aprobador en «Mi ticket» (quien pidió) y en `AprobacionesPage`; el reemplazo mostrado puede tardar hasta 120 s en reflejar cambios ajenos en la cadena; el reemplazo «Otra persona» ve el motivo de los permisos médicos igual que con «Escalar» (validar con el responsable funcional).
