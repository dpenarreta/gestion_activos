# Estrategia de QA

## Capas de prueba

1. **Backend (pytest)** — `backend/apps/*/tests/`. 326 pruebas unitarias/de
   integración HTTP (vía `rest_framework.test.APIClient`), corriendo contra
   una base de datos real (SQL Server, no mocks de ORM).
2. **Integración (pytest-bdd)** — `tests/qa/step_definitions/`. Un
   subconjunto crítico de los escenarios Gherkin conectado end-to-end:
   texto del `.feature` → step definition → llamada HTTP real → aserciones
   sobre la respuesta y la base de datos.
3. **Frontend (Vitest)** — `frontend/tests/`. Pruebas de componentes con
   `@testing-library/react`, mockeando la capa de servicios (`src/api/*`),
   nunca `axios` directamente (excepto donde se prueba el propio
   interceptor).
4. **Verificación manual en navegador** — con Chrome real, no solo pruebas
   automatizadas. Fue precisamente esta capa la que encontró los 3 defectos
   reales documentados en `tests/qa/test-execution-report.md` — las
   pruebas automatizadas no los habían detectado porque no ejercitan CSS ni
   el árbol de componentes montado con estilos reales.

## Por qué Gherkin y por qué pytest-bdd

La regla del proyecto es que **ningún** criterio de aceptación quede
documentado solo como lista informal, README o comentario — debe ser un
escenario Gherkin verificable. Se eligió `pytest-bdd` porque el backend ya
usa `pytest`/`pytest-django`: permite reutilizar exactamente el mismo
`APIClient`, las mismas fixtures y la misma base de datos que las pruebas
"clásicas", sin sumar un segundo framework de pruebas ni un segundo runner.

## Qué está conectado a pytest-bdd y qué no

No se conectó **cada** escenario Gherkin a un step definition — hubiera
significado re-implementar en Gherkin toda la suite pytest existente sin
aportar cobertura nueva. Se conectó un subconjunto que:

- cubre al menos un escenario representativo por archivo `.feature`;
- prioriza los criterios de mayor riesgo (AC-038, autorización, hash de
  contraseñas, expiración de JWT);
- deja el resto explícitamente marcado como "Sí (pytest)" — automatizado,
  pero no vía el parser de Gherkin — en
  `tests/qa/acceptance-criteria-traceability.md`, nunca como "no
  verificado" cuando en realidad sí lo está por otra vía.

Los escenarios sobre el propio repositorio
(`repository-hygiene.feature`) y buena parte de los de arquitectura
(`acceptance-criteria.feature`) describen hechos sobre el repositorio, no
comportamiento en tiempo de ejecución — se verifican por inspección directa
(`git remote -v`, listado de carpetas, lectura de `requirements.txt`), y
así queda documentado explícitamente, no fingido como prueba automatizada.

## Cómo ejecutar cada suite

```bash
# Backend
cd backend
pytest -q

# Integración (Gherkin vía pytest-bdd) — desde la raíz del repositorio
PYTHONPATH="$(pwd)/backend" DJANGO_SETTINGS_MODULE=config.settings.development \
  backend/.venv/Scripts/python.exe -m pytest tests/qa -q

# Frontend
cd frontend
npm run lint
npm test
npm run build
```

## Mantenimiento

Cualquier criterio de aceptación nuevo que surja al extender el sistema
debe, como mínimo:

1. Sumarse como un escenario `Scenario` con una etiqueta `@AC-xxx` (o
   `@AC-<DOMINIO>-xxx` si es un criterio adicional descubierto durante el
   desarrollo, no parte de la lista original) en el `.feature` que
   corresponda.
2. Sumarse a `tests/qa/acceptance-criteria-traceability.md`.
3. Ejecutarse y registrar su resultado real en
   `tests/qa/test-execution-report.md` — nunca marcarlo aprobado sin
   haberlo corrido.
