# Historia de Usuario: US-013 - Llamados de atención en Gestión Humana

- **ID:** US-013
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-12
- **Sprint / Módulo:** Gestión Humana › Llamados de atención (app nueva `backend/apps/llamados`; frontend `pages/GestionHumana/LlamadosAtencion/`; «Mis llamados de atención» en Mi perfil)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-2 (incluye el modelo de datos y las migraciones), DEV-4

---

### 1. Definición de la Historia
- **Como:**
  - Gestión Humana, que asienta y confirma las sanciones;
  - un jefe del organigrama, que pide un llamado de atención para alguien de su equipo;
  - la persona sancionada.
- **Quiero:**
  - registrar llamados de atención por causas configurables, con niveles progresivos (verbal, escrito y sanción económica);
  - notificarlos por correo con un texto personalizable;
  - que la persona los vea en «Mi perfil».
- **Para:**
  - llevar el registro formal de las faltas;
  - escalar las reincidencias de manera uniforme;
  - administrar todo desde la intranet, sin pedir cambios a desarrollo.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Causas y niveles configurables**
  - **Dado que:** tengo `llamados.configurar`.
  - **Cuando:** abro Gestión Humana › Llamados de atención › «Causas».
  - **Entonces:**
    - Creo, edito, activo y desactivo causas. Cada causa tiene nombre, descripción y el plazo de reincidencia en meses (por omisión 12).
    - Cada causa tiene sus niveles ordenados, y puedo agregar, editar, ordenar y quitar niveles mientras ninguno se haya usado. De cada nivel configuro:
      - el nombre, por ejemplo «Primer llamado (verbal)»;
      - el tipo: `verbal`, `escrito` o `sancion_economica`;
      - si envía correo;
      - el asunto y el cuerpo del correo, con variables;
      - el monto sugerido, solo en las sanciones económicas;
      - si se copia al jefe inmediato.
    - Una causa o un nivel ya usados no se borran; se desactivan, para conservar el historial.

- **CA-2 · Causa inicial de prueba**
  - **Entonces:** la migración crea la causa «Incumplimiento de la firma o aceptación del rol de pagos», con un plazo de 12 meses y tres niveles:
    1. «Primer llamado (verbal)»: tipo verbal. No envía correo, pero el hecho queda registrado.
    2. «Segundo llamado (escrito)»: tipo escrito. Envía un correo con un texto inicial.
    3. «Sanción económica»: tipo sancion_economica. Envía correo y pide el monto.
  - Todo es editable después desde la pantalla.

- **CA-3 · Emitir (Gestión Humana)**
  - **Dado que:** tengo `llamados.emitir`.
  - **Cuando:** elijo a una persona de la empresa y una causa.
  - **Entonces:**
    - El sistema propone el nivel siguiente, según los llamados emitidos y no anulados de esa persona por esa causa dentro del plazo de reincidencia. Si ya llegó al último nivel, propone el último.
    - Veo el historial de la persona en esa causa.
    - Puedo cambiar el nivel propuesto, con una justificación obligatoria.
    - Registro la fecha del hecho, la descripción (obligatoria) y, si quiero, un adjunto de evidencia.
    - En una sanción económica el monto es obligatorio y parte del sugerido.
    - Al emitir, queda en estado `emitido`. Si el nivel envía correo, se manda a la persona (con copia al jefe, si está configurado) usando la plantilla del nivel con sus variables.
    - Se avisa en la campana a la persona y queda en la auditoría.

- **CA-4 · Solicitar (jefe del organigrama)**
  - **Dado que:** soy jefe en el organigrama de alguien (directa o indirectamente, según `reportes.debajo`) y tengo `llamados.solicitar`.
  - **Cuando:** abro «Llamados de atención» y pulso «Solicitar llamado».
  - **Entonces:**
    - Solo puedo elegir a personas de mi equipo.
    - Registro la causa, la fecha del hecho y la descripción. El nivel propuesto se calcula igual que en CA-3.
    - Queda en estado `solicitado` y se avisa en la campana a quienes tienen `llamados.emitir`.
    - No se avisa a la persona hasta que Gestión Humana lo confirme.
    - Veo mis solicitudes y su estado.

- **CA-5 · Confirmar o rechazar (Gestión Humana)**
  - **Dado que:** hay un llamado `solicitado` y tengo `llamados.emitir`.
  - **Cuando:** lo reviso.
  - **Entonces:**
    - Puedo confirmarlo, ajustando el nivel (con justificación), el monto o la descripción. Queda `emitido` y se notifica como en CA-3.
    - O puedo rechazarlo con un motivo. Queda `rechazado`.
    - En los dos casos se avisa en la campana al jefe que lo pidió.

- **CA-6 · Anular**
  - **Dado que:** un llamado emitido fue un error.
  - **Cuando:** quien tiene `llamados.emitir` lo anula con un motivo obligatorio.
  - **Entonces:**
    - Queda `anulado` y deja de contar para la reincidencia.
    - Queda en la auditoría.
    - Se avisa a la persona solo si antes se le había notificado.

- **CA-7 · Ver y buscar**
  - **Dado que:** tengo `llamados.ver` (o `emitir`).
  - **Entonces:**
    - Veo todos los llamados de la empresa, con filtros por persona, causa, nivel, estado y fechas.
    - Veo el detalle con su historial: quién lo pidió, quién lo confirmó, cuándo y el correo enviado.
  - Un jefe sin esos permisos ve solo los que solicitó.

- **CA-8 · Mis llamados en Mi perfil**
  - **Dado que:** tengo llamados emitidos.
  - **Cuando:** abro «Mi perfil».
  - **Entonces:**
    - Veo una sección de solo lectura, «Mis llamados de atención», con la fecha, la causa, el nivel, la descripción y el monto de las sanciones.
    - No veo las solicitudes pendientes ni las rechazadas, ni quién lo solicitó.
    - Los anulados aparecen marcados como anulados o no aparecen; lo decide DEV-4 y lo documenta.

- **CA-9 · Permisos (todo nace con los suyos)**
  - **Entonces:**
    - **`llamados.ver`, `llamados.emitir` y `llamados.configurar`:** la migración los concede a los roles de Gestión Humana (Coordinador Nacional de GGHH, Jefe Nacional de Talento Humano y SSO) y a Superusuario. El rol Administrador (TI) no los recibe: van en sus `excluir_prefijos`, como los demás datos de Gestión Humana.
    - **`llamados.solicitar`:** lo reciben los roles de cargo cuyo cargo tiene a alguien a cargo en el organigrama. La regla la decide DEV-2, preferiblemente dinámica en la sincronización por cargo. Además, el servidor exige que la persona sea de su equipo.
    - Sin permiso, la API responde 403 y el menú no muestra la entrada.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Datos + Backend | DEV-2 | App `llamados` con los modelos Causa, Nivel y LlamadoAtencion (estado, nivel propuesto y aplicado, justificación del cambio, hecho, descripción, monto, adjunto, quién solicitó, quién emitió, fechas, correo enviado) y su historial de acciones, todo por empresa (`ModeloDeEmpresa`). Migraciones con la causa inicial. Servicios para proponer el nivel, solicitar, confirmar, rechazar, emitir, anular y notificar (correo con `apps/correos/motor.renderizar` o el mecanismo seguro existente, con las variables escapadas; campana; auditoría). API REST con filtros. Permisos con sus migraciones y la regla de `llamados.solicitar`. Endpoint «mis llamados». Pruebas. |
| Web | DEV-4 | Entrada «Llamados de atención» en el menú del módulo Gestión Humana. Pestañas «Llamados» (lista con filtros, emitir, solicitar, confirmar, rechazar, anular, detalle) y «Causas» (crear y editar causas y niveles con su editor de plantilla, variables y vista previa). Sección «Mis llamados de atención» en Mi perfil. Pruebas. |

**Fuera de alcance:**
- Descontar la sanción en nómina automáticamente.
- Firmas electrónicas de recepción.
- La exportación LOPDP del titular (`privacidad/mis_datos.py`): está en edición por otra sesión y queda como pendiente para cuando se integre.

---

### 4. Contrato (propuesto; DEV-2 lo confirma)
- Base `/api/v1/llamados/`.
  - `causas/` (CRUD, con niveles anidados), con `llamados.configurar`.
  - `variables/`: las variables disponibles para las plantillas.
  - `propuesta/?persona=&causa=`: el nivel propuesto, el historial y el monto sugerido.
  - `llamados/` (lista filtrable; crear = emitir con `emitir`, o solicitar con `solicitar`).
  - `llamados/<id>/` (detalle).
  - `llamados/<id>/confirmar/`, `rechazar/` y `anular/`.
  - `personas/`: a quién puedo dirigirme. Con `emitir`, a toda la empresa; con `solicitar`, solo a mi equipo.
  - `mios/`: «Mi perfil».
- Variables de la plantilla:
  - `{nombre}`, `{apellidos}`, `{causa}`, `{nivel}`, `{fecha_hecho}`, `{descripcion}`, `{monto}`, `{empresa}` y `{emitido_por}`, más las que DEV-2 considere útiles.
  - Se escapan al renderizar.

---

### 5. Decisiones Técnicas y Supuestos
- **Decisiones del usuario (12/11/2026):**
  - Gestión Humana asienta o confirma las sanciones y los jefes del organigrama las solicitan.
  - El sistema propone el nivel.
  - La persona ve sus llamados en «Mi perfil».
  - Las causas, los niveles y los correos se administran desde la interfaz.
  - La causa inicial es la firma o aceptación del rol de pagos, con los niveles verbal, escrito y sanción económica.
- **Sanción económica (normativa a validar):** el monto se guarda como dato, sugerido por nivel y editable al emitir. No se calculan topes legales: el Código del Trabajo limita las multas, y Gestión Humana debe validar los montos. No se descuenta de la nómina.
- **Regla del usuario:** todo lo nuevo nace con sus permisos (CA-9).
- **Coordinación:** otra sesión trabaja en la app móvil y tiene cambios sin commit en `backend/apps/notificaciones/*`, `authentication/services.py`, `config/settings/base.py`, `conftest.py`, `privacidad/mis_datos.py` y `mobile/`. Esta historia no edita esos archivos. Para registrar la app nueva en `INSTALLED_APPS` (`config/settings/base.py`), DEV-2 avisa al Tech Lead, que lo integra con cuidado. Al hacer el commit se incluyen solo los archivos de US-013.

---

### 6. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES (solo observaciones menores e integraciones pendientes de otra sesión).
- **Fecha de cierre:** 2026-11-12
- **QA-FUNC:** APROBADO CON OBSERVACIONES en la ronda 2, con los 9 criterios cumplidos.
- **QA-TECH:** APROBADO CON OBSERVACIONES en la ronda 2: el P1 (decidir sobre lo propio) y los seis P2 (correo dentro de la transacción, doble envío, contrato de la propuesta, N+1, señales del organigrama y correo fallido oculto) quedaron cerrados.
- **QA-UX:** aprobado con observaciones en la ronda 2: resueltos la Crítica (revisión antes de emitir) y los tres Altos.
- **Ronda final de cierre:** con la aprobación ya dada, se cerraron las observaciones restantes:
  - el correo pendiente o fallido, con «Reenviar correo»;
  - el jefe y si la persona tiene correo en la revisión;
  - `nivel_esperado` con 409 `propuesta_cambio`;
  - no perder lo escrito al volver de la revisión;
  - el historial cargado antes de confirmar;
  - el filtro con `modo=ver`.
- **Criterios de aceptación:** CA-1 a CA-9 cumplidos.
- **Decisiones del Tech Lead:**
  - Quien tiene `ver` o `emitir` no ve en la lista los llamados dirigidos a sí mismo (los ve en Mi perfil), y nadie confirma, rechaza ni anula lo propio.
  - `llamados.solicitar` es dinámico: lo lleva el rol de todo cargo con subordinados activos, según el organigrama.
  - `causas/` no muestra las plantillas a quien solo solicita.
  - El correo sale tras el commit.
- **Archivos principales:**
  - Backend:
    - la app `backend/apps/llamados/`, con las migraciones 0001 y 0002;
    - `organizacion/{senales_equipo,permisos_por_cargo,roles_de_cargo,levantamientos,versiones,apps}.py`;
    - `permissions/catalog.py`, permissions 0065 y roles 0051;
    - `crear_roles_iniciales.py`, `empresas/modulos.py` y `config/api_v1_urls.py`;
    - la línea `apps.llamados` en `config/settings/base.py`;
    - `privacidad/tests/test_mis_datos.py`.
  - Frontend:
    - `frontend/src/api/llamadosService.js`, `pages/GestionHumana/LlamadosAtencion/*` y `pages/MisDatos/MisLlamados.jsx`;
    - `MisDatosPage.jsx`, `staticAdminMenu.js`, `modulos/permisosGestionHumana.js`, `routes/AppRoutes.jsx` y `ModalDialog.jsx` (prop `sucio`).
- **Verificación ejecutada (Tech Lead, 12/11/2026):**
  - `makemigrations --check`: sin cambios.
  - `pytest` de llamados, organizacion, roles, permissions, privacidad y empresas con `-n 4`: 1915 passed, 9 skipped y 1 failed. El fallo es de `notificaciones.DispositivoPush`, un modelo sin commit de la sesión de la app móvil ajeno a US-013. Los modelos de `llamados` pasan la prueba de aislamiento por empresa.
  - DEV-4 corrió vitest completo (3275 passed), eslint y prettier sobre lo tocado y `vite build`, todo correcto.
- **Pendientes:**
  - Exportación LOPDP del titular: falta la sección `llamados_de_atencion` en `privacidad/mis_datos.py` y quitar `llamados` de `PENDIENTES_DE_REVISAR`. El archivo está en edición por la sesión de la app móvil.
  - Campana: falta la entrada `"llamados"` en `notificaciones/modulos.py`, también de esa sesión. Hasta entonces, los avisos salen como «Sistema».
  - La causa inicial solo existe en las empresas actuales.
  - Los permisos de Gestión Humana están fuera de `REGLAS`: un cargo nuevo de Gestión Humana no los recibe solo.
  - Los topes legales de las multas los debe validar Gestión Humana (Código del Trabajo); el sistema no los aplica.
  - Falta la prueba manual en el navegador con SMTP real tras desplegar.
