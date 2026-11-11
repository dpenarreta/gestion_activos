# Historia de Usuario: US-002 - Código por correo para consultar el rol de pagos

- **ID:** US-002
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-11
- **Sprint / Módulo:** Rol de pagos (`backend/apps/nomina`, `frontend/src/pages/Institucional/RolPagosPage.jsx`)
- **Estado:** COMPLETADA
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-3, DEV-2, DEV-4

---

### 1. Definición de la Historia
- **Como:** colaborador que consulta su rol de pagos.
- **Quiero:** que al pulsar «Consultar» me llegue a mi correo registrado un código único de 6 dígitos y que, al escribirlo bien, se abra el visualizador del rol.
- **Para:** confirmar que soy yo quien consulta, con algo que solo yo recibo, en lugar de volver a escribir la contraseña de mi cuenta.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · Pedir el código**
  - **Dado que:** estoy en «Consultar rol de pagos», con el año y el mes elegidos y los términos aceptados.
  - **Cuando:** pulso «Consultar».
  - **Entonces:**
    - El sistema genera un código aleatorio de 6 dígitos y lo envía al correo de mi cuenta.
    - La pantalla dice «Le enviamos un código a d***@grupolaar.com» y muestra el campo para escribirlo.
    - Ya no se pide la contraseña.

- **CA-2 · Código correcto: se abre el rol**
  - **Dado que:** recibí el código y no ha vencido.
  - **Cuando:** lo escribo y confirmo.
  - **Entonces:**
    - Se abre el visualizador del rol de ese período, como hoy tras la contraseña.
    - La consulta queda registrada como hoy (`ConsultaRolPagos`: términos, IP, navegador, huella).
    - El código queda usado y no sirve otra vez.

- **CA-3 · Código incorrecto, vencido o agotado**
  - **Dado que:** escribo un código equivocado, vencido (más de 10 minutos), ya usado o de otro período.
  - **Cuando:** confirmo.
  - **Entonces:**
    - Veo un mensaje junto al campo, según el caso:
      - «El código no es correcto.»
      - «El código venció: pida uno nuevo.»
      - Si el código ya no sirve por los 5 fallos: «Ya no quedan intentos con este código: pida uno nuevo.»
      - Si ya se usó o fue reemplazado: «Pida un código para consultar.»
    - Tras 5 intentos fallidos el código se anula y hay que pedir otro.
    - Cada fallo queda en la auditoría, sin el código.

- **CA-4 · Reenviar**
  - **Dado que:** no me llegó el código.
  - **Cuando:** pulso «Enviar otro código».
  - **Entonces:**
    - Se anula el anterior y llega uno nuevo.
    - El botón espera 60 segundos entre envíos.
    - No se envían más de 5 códigos por hora y persona. Pasado ese límite, el mensaje dice cuándo puede volver a intentarlo.

- **CA-5 · Sin correo**
  - **Dado que:** mi cuenta no tiene correo.
  - **Cuando:** pulso «Consultar».
  - **Entonces:** veo «Su cuenta no tiene un correo registrado: pídale a Talento Humano que lo registre». No se genera código.

- **CA-6 · Seguridad del código**
  - **Dado que:** existe un código pendiente.
  - **Entonces:**
    - Se guarda solo su hash, nunca en claro, y se compara en tiempo constante.
    - Es de un solo uso.
    - Está atado a la persona, al código de empleado y al período pedidos.
    - No aparece en registros, auditoría ni respuestas de la API.
    - El correo dice para qué es, cuánto dura y que nadie de la empresa se lo pedirá.

---

### 3. Alcance Técnico por Capa
| Capa | Sub-Agente | Entregables Requeridos |
|---|---|---|
| Datos | DEV-3 | Modelo `CodigoConsultaRol` en `nomina`: usuario, código de empleado, año, mes, hash, creado, vence, intentos, usado_en, anulado. Índices por usuario y fecha. Migración aplicada en local. |
| Backend | DEV-2 | Servicio para emitir, verificar y anular el código, con límites. `POST /nomina/consultar/codigo/` para pedir o reenviar. `POST /nomina/consultar/` recibe `codigo_verificacion` en lugar de `password`. Plantilla de correo en `correos/catalogo.py`. Auditoría. Pruebas. |
| Web | DEV-4 | `RolPagosPage.jsx` en dos pasos: «Consultar» envía el código; luego un campo de 6 dígitos (`inputMode="numeric"`, `autoComplete="one-time-code"`) con «Confirmar» y «Enviar otro código», que espera 60 s. Errores junto al campo. Pruebas. |

**Fuera de alcance:** las otras pantallas del rol de pagos siguen pidiendo la contraseña: historial de Talento Humano, descarga masiva y auditado.

---

### 4. Contrato

| Operación | Ruta | Acceso | Entrada | Salida | Errores |
|---|---|---|---|---|---|
| Pedir o reenviar el código | `POST /api/v1/nomina/rol-pagos/consultar/codigo/` | Autenticado + permiso propio de consulta. Throttle `rol_pagos` | `{anio, mes, acepto, version, codigo?}` | `{enviado_a: "d***@dominio", vence_en: segundos, reenviar_en: 60}` | 400 términos, período o sin correo; 429 límite de envíos o espera de 60 s, con `details.retry_after` y la cabecera `Retry-After`; 503 `codigo_no_enviado` si el correo no sale (el código no queda) |
| Consultar | `POST /api/v1/nomina/rol-pagos/consultar/` (existente) | Igual que hoy | `{anio, mes, acepto, version, codigo?, codigo_verificacion}` | El PDF, como hoy | 400 `codigo_verificacion`: incorrecto, vencido o agotado; los demás, como hoy |

---

### 5. Decisiones Técnicas y Supuestos
- **Correo registrado:** es el de la cuenta (`User.email`), no el correo personal guardado para enviar el rol.
- **Parámetros por defecto:** el código vence a los 10 minutos; admite 5 intentos; espera de 60 s para reenviar; máximo 5 códigos por hora. Quedan como constantes en un solo lugar y son ajustables.
- **Sin bloqueo de la cuenta:** los fallos del código no bloquean el inicio de sesión. El código se anula a los 5 intentos y los envíos están limitados, así que adivinarlo no es práctico: 5 intentos sobre 1 000 000 de combinaciones por código.
- **Generación:** se usa `secrets.randbelow(10**6)` con ceros a la izquierda. El hash es HMAC-SHA256 con `SECRET_KEY`.
- **Envío:** con el mecanismo de correos del sistema (`alertas.eventos.enviar` o el que use el rol de pagos para enviar el PDF), después del commit.

---

### 6. Registro de Cierre

- **Estado final:** COMPLETADA
- **Fecha de cierre:** 2026-11-11
- **QA-FUNC:** 🟡 Aprobado con observaciones (B1–B5 resueltas) · **QA-TECH:** 🟡 Aprobado con observaciones (ronda 2; la 1 rechazó por 2 P2, corregidos) · **QA-UX:** 🟢 sin Altos en la ronda 2 (la 1 tuvo 3 Altos, corregidos)
- **Criterios de aceptación:** CA-1 ✅, CA-2 ✅, CA-3 ✅, CA-4 ✅, CA-5 ✅, CA-6 ✅
- **Archivos principales:** `backend/apps/nomina/codigo.py`, `nomina/services.py`, `nomina/views.py`, `nomina/migrations/0011_codigo_consulta_rol.py`, `correos/catalogo.py`, `core/exceptions.py`, `core/sensitive_data.py`, `frontend/src/pages/Institucional/RolPagosPage.jsx`, `frontend/src/utils/errores.js`
- **Verificación ejecutada:** la misma corrida que US-001 (1100 passed backend, 2978 passed frontend, build correcto).
- **Pendientes:** Ninguno.
