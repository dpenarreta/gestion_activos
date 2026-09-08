# Artefactos heredados de la plantilla base

Este proyecto nació como copia de
[`dpenarreta/skelleton_base`](https://github.com/dpenarreta/skelleton_base)
(commit `a9896f1`, VERSION `0.1.0`), adoptada como **criterio base de
seguridad** del sistema.

Los archivos de esta carpeta documentan la construcción de esa plantilla,
no el sistema de Gestión de Activos. Se conservan porque respaldan la
trazabilidad de los controles de seguridad heredados
(`docs/security-review.md`, `docs/data-protection-review.md`), pero no
describen requisitos del proyecto actual y no deben mantenerse al día.

| Archivo | Qué documenta |
| --- | --- |
| `migration-report.md` | Cómo se particionó el repositorio `skelleton` para producir `skelleton_base` |
| `repository-partition.feature` | Criterios de aceptación AC-001…AC-007, AC-025, AC-026 de esa partición (verificados manualmente, sin `step_definitions`) |

Los criterios de aceptación **vigentes** del sistema viven en
`tests/qa/features/`.
