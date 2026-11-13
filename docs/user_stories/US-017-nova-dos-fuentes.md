# Historia de Usuario: US-017 - Nova con dos fuentes: los documentos y, si no responden, Claude

- **ID:** US-017
- **Tipo:** Historia de Usuario
- **Fecha:** 2026-11-13
- **Sprint / Módulo:** Gestión Humana › Nova, chat (`backend/apps/nova/chat.py`, `ajustes.py`; `frontend/src/components/admin/NovaChat/`)
- **Estado:** COMPLETADA
- **Tech Lead Asignado:** Tech-Lead Orchestrator
- **Desarrolladores Requeridos:** DEV-2, DEV-4

---

### 1. Definición de la Historia
- **Como:** persona que usa Nova en el modo General.
- **Quiero:** que Nova responda con los documentos de la base de conocimiento cuando la respuesta está en ellos, y con el conocimiento general de Claude cuando no está.
- **Para:** tener siempre una respuesta, sin confundir la información general con la política de la empresa.

---

### 2. Criterios de Aceptación (Gherkin / BDD)

- **CA-1 · La respuesta está en los documentos**
  - **Dado que:** la búsqueda encuentra fragmentos que responden la pregunta.
  - **Cuando:** pregunto en el modo General.
  - **Entonces:**
    - Claude redacta la respuesta solo con esos fragmentos, sin agregar conocimiento propio, y los cita «[Título, pág. N]».
    - La respuesta llega con `origen="documentos"` y sin aviso.

- **CA-2 · La respuesta no está en los documentos**
  - **Dado que:** no hay fragmentos o no responden la pregunta.
  - **Cuando:** pregunto en el modo General.
  - **Entonces:**
    - Claude responde con su conocimiento general.
    - La respuesta llega con `origen="general"` y un aviso visible: no está en los documentos de la empresa y conviene confirmarla con Gestión Humana.
  - **Y si:** los documentos responden solo una parte, `origen="mixto"`, con su propio aviso.

- **CA-3 · Valor por defecto y ajuste**
  - **Entonces:**
    - «Responder solo con las fuentes» pasa a estar desactivado por defecto, así que las dos fuentes son lo normal.
    - Quien tiene `nova.conocimiento_gestionar` puede activarlo, y entonces Nova vuelve a responder solo con los documentos, sin conocimiento general.

- **CA-4 · Modos con datos de personas**
  - **Entonces:** Mis tareas y Mi equipo no cambian y no llevan `origen`.

---

### 3. Alcance Técnico por Capa
| Capa | Entregables |
|---|---|
| Backend | Instrucción `_FUENTES_DOS`: primero los documentos; si no responden, conocimiento general, empezando con `MARCA_GENERAL`. `separar_origen` quita la marca y calcula `origen`. La respuesta lleva `origen` y `aviso_origen`. `SOLO_FUENTES_POR_DEFECTO=False`. Pruebas en `test_dos_fuentes.py`. |
| Web | El mensaje de Nova muestra `aviso_origen` en `.nova-mensaje__origen`, con los tokens de advertencia. Nueva descripción del modo General. Pruebas. |

---

### 4. Decisiones Técnicas y Supuestos
- **Decisión del usuario (13/11/2026):**
  - Con la respuesta en los documentos, Claude la redacta solo con ellos. No se muestra el fragmento sin IA: una respuesta no se puede redactar sin la IA.
  - Sin ella, conocimiento general con aviso visible.
- **Proveedor:** la única IA es Claude por la API (Anthropic). Ver la memoria del proyecto.
- **Cómo se calcula el origen:**
  - Con la marca, es `general`, o `mixto` si además cita documentos.
  - Sin marca, es `documentos` solo si cita alguno.
  - Sin marca ni citas, es `general`: ante la duda, se avisa.
- **Sin cambios:**
  - La privacidad sigue igual: seudónimos, sin salud fuera del modo General, consentimiento y límite diario.
  - Las fuentes consultadas se siguen devolviendo aunque el origen sea general.

---

### 5. Registro de Cierre
- **Estado final:** COMPLETADA
- **Fecha de cierre:** 2026-11-13
- **Criterios de aceptación:** CA-1 ✅ · CA-2 ✅ · CA-3 ✅ · CA-4 ✅
- **Verificación ejecutada:**
  - pytest de `apps/nova`: 133 pasan.
  - Vitest de Nova (NovaSoloFuentes, NovaChat, GestionHumanaNova): 51 pasan.
  - ruff y eslint sin hallazgos.
- **Pendientes:** ninguno.
