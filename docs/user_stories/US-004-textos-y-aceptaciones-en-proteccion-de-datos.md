# Historia de Usuario: US-004 - Todos los textos de protección de datos y sus aceptaciones en «Protección de datos»

- **ID:** US-004
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-11
- **Sprint / Módulo:** Protección de datos (`apps/privacidad`, `frontend/src/pages/Privacidad`) con impacto en Organización, Rol de pagos, Códigos de conducta, Nova y Mi perfil
- **Estado:** COMPLETADA
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-3, DEV-2, DEV-4

---

### 1. Definición de la Historia
- **Como:** responsable de protección de datos de la empresa.
- **Quiero:** tener en el menú «Protección de datos» todos los textos sobre datos personales que el sistema muestra, para editarlos, y todas sus aceptaciones, para consultarlas. Todo ordenado por módulo y sección.
- **Para:** administrar y demostrar el cumplimiento de la LOPDP desde un solo lugar, sin buscar cada texto en su pantalla ni depender de cómo guarda la constancia cada módulo.

---

### 2. Inventario (11/11/2026)

| Módulo | Sección | Texto | Hoy vive en | Requiere aceptación |
|---|---|---|---|---|
| General | Entrada a la intranet | Aviso de tratamiento de datos | `privacidad.AvisoPrivacidad` | Sí |
| Mi perfil | Teléfono personal | Autorización del teléfono personal | `organizacion.TextoLegal` (`autorizacion_telefono`) | Sí |
| Mi perfil | Cumpleaños | «Acepto que mi día de cumpleaños sea información pública…» | Fijo en `MiCumpleanos.jsx` | Sí |
| Mi perfil | Aniversario | «Acepto que mi aniversario… sea información pública…» | Fijo en `MiAniversario.jsx` | Sí |
| Mi perfil | Mis derechos | Explicación de los derechos LOPDP y de cada tipo de solicitud | Fijo en `MisDerechos.jsx` / `privacidadComunes.js` | No |
| Institucional › Rol de pagos | Consultar | Términos de la consulta | `nomina.ConfiguracionRolPagos.terminos` | Sí (en cada consulta) |
| Institucional › Rol de pagos | Enviar al correo | Consentimiento para guardar el correo personal | `nomina.ConfiguracionRolPagos.consentimiento_correo` (sin versión) | Sí |
| Institucional › Códigos de conducta | Leer documentos | Acuerdo de confidencialidad | `organizacion.AcuerdoConfidencialidad` | Sí |
| Nova (IA) | Chat y paneles | Avisos «Cómo se protegen sus datos» (por modo) | Fijos en `NovaChatContext.jsx`, `ConversacionNova.jsx`, `PanelNova.jsx` | No |

---

### 3. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Un solo catálogo de textos**
  - **Dado que:** abro «Protección de datos» → «Textos».
  - **Entonces:**
    - Veo todos los textos del inventario, agrupados por módulo y, dentro de cada módulo, por sección.
    - Cada uno muestra su nombre, si pide aceptación, la versión vigente, cuándo y quién la editó por última vez, y el texto.

- **CA-2 · Editar un texto**
  - **Dado que:** tengo el permiso «Editar textos de protección de datos».
  - **Cuando:** edito un texto y guardo, con un motivo opcional.
  - **Entonces:**
    - Si el texto cambió, la versión sube.
    - Queda en la auditoría con el texto anterior y el nuevo.
    - Desde ese momento, el texto nuevo es el que ve el usuario en su pantalla.
    - El texto debe tener entre 20 y 6000 caracteres. Si no, se rechaza con el error junto al campo.

- **CA-3 · Nuevas aceptaciones tras un cambio**
  - **Dado que:** un texto que pide aceptación cambió de versión.
  - **Entonces:** se conserva el comportamiento de hoy en cada caso:
    - Aviso general: se pide de nuevo si al guardar se marca «Pedir aceptarlo de nuevo».
    - Teléfono, cumpleaños y aniversario: se pide al guardar de nuevo o al volver a activarlos.
    - Rol de pagos: se acepta en cada consulta.
    - Correo personal: se pide al volver a guardarlo.
    - Acuerdo de confidencialidad: se pide al cambiar sus documentos o su texto.

- **CA-4 · Registro común de aceptaciones**
  - **Dado que:** una persona acepta cualquier texto del catálogo.
  - **Entonces:**
    - Queda una fila con persona, texto (clave), versión, el texto exacto aceptado, fecha y hora, IP y origen.
    - Las filas no se sobrescriben: forman un historial.
    - Retirar una autorización (teléfono, cumpleaños, aniversario o correo) deja la fecha de retiro, sin borrar la fila.

- **CA-5 · Ver las aceptaciones**
  - **Dado que:** tengo el permiso de ver protección de datos.
  - **Cuando:** abro «Protección de datos» → «Aceptaciones».
  - **Entonces:**
    - Veo las aceptaciones agrupadas por módulo y sección, con filtro por texto, por persona y por vigentes o retiradas.
    - De cada aceptación veo persona, versión, fecha, IP y si sigue vigente o fue retirada.
    - Puedo abrir el texto exacto que aceptó y exportar a Excel.

- **CA-6 · Las aceptaciones de antes no se pierden**
  - **Dado que:** existían aceptaciones antes de este cambio.
  - **Cuando:** se aplica la migración.
  - **Entonces:**
    - Pasan al registro común con lo que se tenía.
    - Las que solo guardaban la fecha (cumpleaños, aniversario, correo) quedan sin IP ni texto, marcadas como «migrada».

- **CA-7 · Un solo lugar para editar**
  - **Entonces:**
    - Configuración → «Textos legales» desaparece.
    - La ventana «Configurar» del rol de pagos deja de editar los términos y el consentimiento del correo, y enlaza a «Protección de datos».
    - «Gestionar documentos» de Códigos de conducta deja de editar el acuerdo y sus aceptaciones, y enlaza a «Protección de datos».
    - El aviso general se edita desde el catálogo.
    - Todo lo demás de esas pantallas sigue igual.

- **CA-8 · Los textos fijos pasan a ser editables**
  - **Entonces:**
    - Cumpleaños, aniversario, la explicación de derechos y los avisos de Nova se leen del catálogo.
    - Su texto inicial es exactamente el de hoy.
    - Si el servidor no responde, la pantalla muestra un texto de respaldo y no deja aceptar sin el texto del servidor.

- **CA-9 · Permisos**
  - **Entonces:**
    - Hay un permiso nuevo: `privacidad.textos`, «Editar textos de protección de datos».
    - La migración lo da a quien hoy tiene `privacidad.atender`, `configuracion.textos_legales`, `roles_pago.configurar` o `codigos.acuerdo`, para que nadie pierda acceso.
    - Ver los textos y las aceptaciones exige `privacidad.ver` o `privacidad.atender`.
    - El rol «Administrador» (TI) también lleva `privacidad.textos`, por decisión del usuario del 11/11/2026. Solo ese permiso: sigue sin `privacidad.ver` ni `privacidad.atender`, que son de las solicitudes de derechos (decisión del 09/11/2026).
    - Quien tiene `privacidad.textos` ve también la pestaña «Textos».
    - Sin permiso: 403. El menú solo muestra lo permitido.

---

### 4. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Datos | DEV-3 | Catálogo de textos y registro común de aceptaciones en `apps/privacidad`, ambos por empresa. Migración de datos desde `AvisoPrivacidad`, `TextoLegal`, `ConfiguracionRolPagos` y `AcuerdoConfidencialidad`, y de las aceptaciones de `AceptacionAviso`, `DatosDeContacto` (teléfono, cumpleaños, aniversario, correo), `ConsultaRolPagos` y `AceptacionConfidencialidad`. Permiso nuevo y su reparto. |
| Backend | DEV-2 | Servicio único de textos (leer, guardar con versión y auditoría) y de aceptaciones (registrar, retirar). Cada flujo actual lee su texto del catálogo y registra en el registro común, sin romper su contrato. Endpoints de catálogo, de edición y de aceptaciones (lista filtrable y Excel). Retirar las ediciones viejas. Exportación LOPDP. Pruebas. |
| Web | DEV-4 | «Protección de datos» con pestañas «Solicitudes» (la de hoy), «Textos» y «Aceptaciones». Agrupación por módulo y sección, editor con vista previa, versiones, filtros y Excel. Las pantallas de cumpleaños, aniversario, derechos y Nova leen del catálogo. Se quita la edición de Configuración, de Rol de pagos y de Códigos de conducta, dejando un enlace. Pruebas. |

**Fuera de alcance:**
- Textos que no son de datos personales: avisos del primer día del rol, plantillas de correo de las solicitudes.
- Traducciones.
- Firmar electrónicamente las aceptaciones.

---

### 5. Contrato (propuesto; DEV-2 lo confirma)

| Operación | Ruta | Acceso | Salida / Entrada |
|---|---|---|---|
| Catálogo | `GET /api/v1/privacidad/textos/` | `privacidad.ver`/`atender` | `[{clave, modulo, seccion, nombre, requiere_aceptacion, version, texto, editado_en, editado_por}]` |
| Texto vigente (público para quien lo ve) | `GET /api/v1/privacidad/textos/<clave>/vigente/` | Autenticado | `{clave, version, texto}` |
| Editar | `PUT /api/v1/privacidad/textos/<clave>/` | `privacidad.textos` | `{texto, motivo?, pedir_de_nuevo?}` → el texto actualizado |
| Aceptaciones | `GET /api/v1/privacidad/aceptaciones/?clave=&modulo=&persona=&estado=vigente\|retirada&page=` | `privacidad.ver`/`atender` | Paginado: `{persona:{id,nombre}, clave, modulo, seccion, version, aceptado_en, ip, origen, retirada_en, migrada}` |
| Texto aceptado | `GET /api/v1/privacidad/aceptaciones/<id>/` | Ídem | Incluye `texto` |
| Excel | `GET /api/v1/privacidad/aceptaciones/excel/?…` | Ídem | Archivo |

---

### 6. Decisiones Técnicas y Supuestos
- **Decisiones del usuario (11/11/2026):**
  - Alcance: además de los seis seguros, entran el acuerdo de confidencialidad, los avisos de Nova y la explicación de derechos.
  - Se edita solo en «Protección de datos».
  - Hay un permiso propio.
  - El registro de aceptaciones es común y completo.
- **Comportamiento tras un cambio:** se respeta el de cada caso (CA-3). La historia unifica dónde se edita y cómo se registra, no las reglas de cada flujo.
- **Modelos de origen:** los modelos de hoy no se borran en esta historia. Dejan de usarse para el texto y la constancia, y una historia posterior los limpia. Así se puede volver atrás.
- **Volumen de la migración:** `ConsultaRolPagos` crece con cada consulta y se migra entera. Hay que medir el volumen en producción antes de desplegar.

---

### 7. Registro de Cierre
- **Estado final:** COMPLETADA
- **Fecha de cierre:** 2026-11-11
- **QA-FUNC:** CON OBSERVACIONES (aprobado) · **QA-TECH:** APROBADO en ronda 2 · **QA-UX:** sin hallazgos Altos en ronda 2
- **Criterios de aceptación:** CA cumplidos. Los 17 textos del catálogo se editan con versión e historial en «Protección de datos»; las aceptaciones se consultan, filtran (incluido «restablecida», en el servidor) y exportan a Excel (tope 100 000 filas). Las ediciones antiguas responden 410 o quedan de solo lectura.
- **Archivos principales:** `backend/apps/privacidad/{catalogo_textos,textos,views,serializers,urls}.py`, migraciones privacidad 0006/0007, permissions 0059, roles 0045; `frontend/src/pages/Privacidad/{ProteccionDatos,TextosPrivacidad,AceptacionesPrivacidad,PersonasDelAviso,SeEditaEnProteccionDeDatos}.jsx`, `hooks/useTextoVigente.js`, `pages/MisDatos/CasillaDeAceptacion.jsx`.
- **Verificación ejecutada:** Verificación final del 11/11/2026, con nada más corriendo: `pytest` de las 18 apps tocadas con `-n 4`: 3958 passed, 8 skipped. `makemigrations --check`: sin cambios. `vitest run`: 3141 passed. `vite build`: correcto. eslint sobre los archivos tocados: limpio, salvo tres `autoFocus` que ya existían en dashboards.
- **Pendientes:** El Administrador de TI tiene `privacidad.textos` (edita los textos) pero sigue sin atender solicitudes de derechos, por decisión del usuario.
