# US-033 · Sanción en % del sueldo o monto fijo, y razón del reglamento

- **Tipo:** Historia de usuario (web)
- **Estado:** COMPLETADA CON PENDIENTES
- **Fecha:** 18/11/2026
- **Módulo:** Gestión Humana · Llamados de atención (`apps.llamados`, `frontend/src/pages/GestionHumana/LlamadosAtencion/`)

## Historia

**Como** quien emite o confirma un llamado de atención (Talento Humano o el jefe con permiso),
**quiero** que una sanción económica se exprese como **porcentaje del sueldo** o como **monto fijo**, y registrar **la razón dentro del reglamento interno** (el documento institucional y el artículo incumplido),
**para** que la sanción quede fundamentada en la norma y lista para descontarse del sueldo cuando nómina lo provea.

## Decisiones del usuario (18/11/2026)

1. **Porcentaje o monto fijo.** En una sanción económica se elige una de las dos formas. Con porcentaje se guarda el % y el **monto queda «por calcular»**: el sueldo todavía no está en el sistema (llegará con el procedimiento de nómina, ver memoria `llamados-sanciones-contra-sueldo`). No se pide el sueldo a mano.
2. **Razón del reglamento = documento + artículo.** Se elige uno de los documentos institucionales activos ya cargados en «Códigos de conducta» (`organizacion.DocumentoInstitucional`: código de conducta, reglamento disciplinario u otra norma) y se escribe el artículo o numeral incumplido (p. ej. «Art. 45, lit. c»). Desde el llamado se puede abrir el documento.
3. **Tope configurable.** Talento Humano define un tope en % del sueldo por empresa (vacío = sin tope). Una sanción en porcentaje que lo supera no se emite. La cifra del tope legal **no se asume**: la configura Talento Humano (pendiente validar con el Código del Trabajo).

## Criterios de aceptación

- **CA-1** Dado un nivel de tipo sanción económica, cuando se emite o confirma el llamado, entonces se elige «Monto fijo (USD)» o «Porcentaje del sueldo (%)», con su valor.
- **CA-2** Dado «Porcentaje del sueldo», cuando se guarda, entonces se registra el % (mayor que 0 y hasta 100, con hasta dos decimales), el monto queda vacío y el llamado muestra «X % del sueldo · monto por calcular».
- **CA-3** Dado «Monto fijo», cuando se guarda, entonces se comporta como hoy (monto sugerido por el nivel y editable).
- **CA-4** Dado un tope configurado, cuando el % lo supera, entonces el servidor rechaza con un error en el campo del porcentaje que dice el tope.
- **CA-5** Dado el formulario del llamado, cuando se registra la razón, entonces se elige un documento institucional activo de la empresa y se escribe el artículo o numeral; ambos quedan guardados con el llamado (el título del documento se conserva aunque el documento cambie después).
- **CA-6** Dado un llamado con documento, cuando se ve su detalle, entonces muestra el documento (con enlace para verlo en el visor interno) y el artículo.
- **CA-7** Dado el nivel de sanción económica en «Causas», cuando se configura, entonces se puede sugerir un porcentaje o un monto.
- **CA-8** Las variables del correo del llamado (y del PDF, cuando el módulo lo tenga: hoy no genera PDF) incluyen la forma de la sanción («5 % del sueldo» o «25,00 USD») y la razón del reglamento («Reglamento interno, Art. 45, lit. c»).
- **CA-9** Los llamados existentes siguen igual (monto fijo, sin documento).

## Alcance por capa

- **Datos/Backend (`apps.llamados`):** campos nuevos en `LlamadoAtencion` (forma de la sanción, porcentaje, documento, título del documento conservado, artículo) y en `NivelLlamado` (porcentaje sugerido); tope por empresa; validaciones; serializers; variables de correo/PDF; migración; pruebas.
- **Web:** formulario del llamado, detalle, configuración del nivel en Causas y el tope en la configuración del módulo.
- **App móvil:** fuera de esta historia (la lleva la sesión de la app).

## Contrato

Base `/api/v1/llamados/`:
- `llamados/` y `llamados/<id>/confirmar/` reciben `forma_sancion` («monto» | «porcentaje»), `porcentaje`, `documento` (id) y `articulo` (≤ 120). El jefe que solo solicita registra la razón, no la sanción.
- La lista, el detalle y `mios/` devuelven `forma_sancion`, `porcentaje`, `monto_por_calcular`, `sancion_texto`, `documento` {id, titulo, categoria, es_pdf, disponible, url}, `articulo` y `razon`.
- Los niveles reciben `porcentaje_sugerido` y devuelven `forma_sugerida`; `propuesta/` trae `tope_porcentaje`.
- `GET documentos/`: los documentos institucionales activos de la empresa.
- `GET|PUT|PATCH configuracion/`: `tope_porcentaje` por empresa (`ConfiguracionLlamados`); lo cambia quien tiene `llamados.configurar`.
- Variables de correo nuevas: `{{sancion}}`, `{{porcentaje}}`, `{{documento}}`, `{{articulo}}`, `{{razon}}`.

## Decisiones técnicas

- Al confirmar, si Gestión Humana deja el mismo documento que registró el jefe, se conserva aunque se haya retirado después, con su título de entonces. Un documento retirado distinto se rechaza.
- El tope se guarda por empresa; sin cifra legal precargada.
- El enlace al documento abre el visor interno solo si es PDF.

## Registro de cierre (18/11/2026)

- **DEV-2 Backend:** modelo, migración `llamados.0003`, validaciones, tope, API, variables de correo y pruebas (`tests/test_sancion_y_razon.py`).
- **DEV-4 Web:** `SancionYRazon.jsx`, `TopeDeSancion.jsx` y los cambios en el formulario, el detalle, la revisión, la lista, Causas y Mis llamados.
- **QA-FUNC:** bloqueó por la razón pasada como texto en el formulario de emitir (corregido, con prueba) y observó el documento retirado al confirmar (resuelto en el servidor).
- **QA-TECH:** el mismo P2 (corregido); P3 aplicados: `llamados` en la prueba de aislamiento, auditoría con la sanción y la razón anteriores al confirmar, el tope en una transacción, la vista previa del correo y el rango del porcentaje.
- **QA-UX:** la crítica (la misma) y las altas y medias aplicadas: «Sanción» como etiqueta única, aviso de tope asociado al campo, nota de «monto por calcular», documento retirado y no PDF, área táctil.

**Pendientes:**
- Las plantillas de correo existentes que usen «USD {monto}» deben pasar a `{{sancion}}`: con porcentaje, `{monto}` queda vacío en el correo real.
- Si se baja el tope por debajo del porcentaje sugerido de un nivel ya guardado, editar esa causa pide corregir la sugerencia.
- Revisión visual en el navegador, que en esta ronda no fue posible.
- La versión móvil la lleva la sesión de la app.
