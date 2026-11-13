# Historia de Usuario: US-020 - Correo con el respaldo al aprobarse un permiso, y tipos de permiso según el flujo de Gestión Humana

- **ID:** US-020
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-13
- **Sprint / Módulo:** Institucional › Solicitudes › Permisos (`backend/apps/licencias`, `apps/correos`; `frontend/src/pages/Institucional/FlujosPermisoPage.jsx`)
- **Estado:** COMPLETADA CON PENDIENTES
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-2, DEV-4

---

### 1. Definición de la Historia
- **Como:** Gestión Humana (Analista de Clima y Cultura).
- **Quiero:** que cada permiso aprobado me llegue por correo, con su documento de respaldo, y que existan los tipos de permiso habituales con el flujo de la empresa.
- **Para:** registrar la novedad en el reporte mensual sin pedirle el documento a nadie.

**Flujo de Gestión Humana** (Excel «Flujo de permisos», 13/11/2026):
1. El trabajador genera la solicitud.
2. El jefe inmediato la autoriza.
3. La solicitud aprobada llega por correo a la Analista de Clima y Cultura, con el documento de respaldo.
4. La Analista la registra en el reporte de novedades mensuales.
5. A mediados y a fin de mes envía el reporte al Coordinador Nacional de GH, que lo condensa y lo pasa a Nómina.

Los pasos 4 y 5 son el reporte de novedades y siguen fuera del sistema.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Aviso también por correo**
  - **Dado que:** configuro un tipo de permiso.
  - **Cuando:** en «Si se aprueba, se avisa a:» marco «También por correo, con el documento de respaldo» en un destino.
  - **Entonces:**
    - Se guarda en ese aviso.
    - En «Si se rechaza» no existe esa opción, y si llega se ignora.

- **CA-2 · El correo**
  - **Dado que:** se aprueba una solicitud de ese tipo.
  - **Entonces:**
    - A las personas de los avisos marcados les llega un correo con quién la pidió, el tipo, las fechas (y horas), el motivo, quién la aprobó y el enlace a la solicitud.
    - Lleva el documento de respaldo adjunto, si lo tiene.
    - La campana llega como siempre a todos los avisos, sin repetirse por el correo.
    - El correo sale después de confirmar la aprobación. Un SMTP caído no la deshace.
    - Un rechazo no manda este correo.
    - La plantilla `licencias.solicitud_aprobada` se edita en Configuración › Plantillas de correo.

- **CA-3 · Tipos de permiso** (configuración, local y luego producción)
  - **Vacaciones:**
    - Solo aprueba el jefe inmediato (se quita el paso de Talento Humano).
    - Aviso con correo a la Analista de Clima y Cultura.
    - Sus reglas no cambian: 2 sábados y 2 domingos por período, mínimo de 5 días y descuento de vacaciones.
  - **Permiso médico:** se agrega el aviso con correo a la Analista de Clima y Cultura. Sus pasos no cambian.
  - **Tipos nuevos:**
    - Permiso personal, Calamidad doméstica, Matrimonio, Paternidad, Maternidad y Fallecimiento de un familiar.
    - Aprueba el jefe inmediato. Al aprobarse, avisan a quien pidió y, con correo, a la Analista de Clima y Cultura. Al rechazarse, avisan a quien pidió.
    - Sin límites de días: los días legales los valida Gestión Humana y se configuran después.

---

### 3. Decisiones Técnicas y Supuestos
- **Decisiones del usuario (13/11/2026):** agregar los tipos habituales; en Vacaciones, solo el jefe aprueba; agregar el correo con adjunto; aplicar en local y luego en producción.
- **Correo por aviso**, no global. Así cada tipo decide quién lo recibe por correo. Campo `AvisoFlujo.correo`, migración licencias 0007.
- **`eventos.enviar`** acepta `adjuntos` y `con_campana=False`, para no duplicar la campana que ya envía el flujo.
- **Supuestos de los tipos nuevos, a validar por Gestión Humana:**
  - Todos son con goce de sueldo (`descuento=ninguno`), por días y con documento de respaldo opcional.
  - Tipo de ausencia «Personal», salvo Maternidad, que va como «Médica» para proteger el dato de salud.
  - Los días legales de cada uno se cargan después en «Mínimo» y «Máximo de días».
- **LOPDP:** el correo de un permiso médico lleva el certificado. Solo lo recibe quien el tipo marca, que es Gestión Humana.

---

### 4. Registro de Cierre
- **Estado final:** COMPLETADA CON PENDIENTES
- **Fecha de cierre:** 2026-11-13
- **Criterios de aceptación:** CA-1 ✅ · CA-2 ✅ · CA-3 ✅ en local (producción pendiente)
- **Archivos principales:**
  - Backend: `apps/licencias/{correos,services,serializers,models}.py`, migración licencias 0007, `apps/correos/catalogo.py` (plantilla `licencias.solicitud_aprobada`), `apps/alertas/eventos.py` (`adjuntos`, `con_campana`).
  - Web: `pages/Institucional/FlujosPermisoPage.jsx` (casilla «También por correo, con el documento de respaldo» en «Si se aprueba») e `Institucional.css`.
- **Configuración en local** (script idempotente que pasa por `FlujoSerializer`):
  - Vacaciones: un solo paso, «Aprobación de jefatura». Correo al cargo «Analista Clima y Cultura». Reglas intactas: 5 días mínimos, 2 sábados y 2 domingos por período, descuento de vacaciones.
  - Permiso médico: se le suma el correo.
  - Tipos creados: Permiso personal, Calamidad doméstica, Matrimonio, Paternidad, Maternidad (Médica, documento obligatorio) y Fallecimiento de un familiar.
- **Verificación ejecutada:**
  - pytest de licencias, correos, alertas, soporte, activos, matriz y notificaciones: 871 pasan.
  - Vitest completo: 3313 de 3313.
  - `makemigrations --check`: sin cambios.
- **Pendientes:**
  - Revisión visual en vivo del editor de tipos: la sesión local se cerró y no hubo cómo iniciarla.
  - Desplegar (licencias 0007) y correr la configuración en producción.
  - Que Gestión Humana valide los días legales y el descuento de los tipos nuevos.
