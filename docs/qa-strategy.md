# Estrategia de QA

## Capas de prueba

1. **Backend (pytest)** — `backend/apps/*/tests/`. 509 pruebas unitarias/de
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
4. **Extremo a extremo (Playwright)** — `frontend/e2e/`. Un navegador de
   verdad contra la aplicación de verdad: el frontend en 5174 y el backend en
   8010, con su base de datos. Cubre los recorridos que ninguna de las tres
   capas anteriores cruza enteros —la sesión viajando entre pantallas, el
   cambio de empresa que recarga la aplicación, la descarga de un archivo—.
   Se ejecuta con `npm run e2e` desde `frontend/`.
5. **Verificación manual en navegador** — con Chrome real. Fue precisamente
   esta capa la que encontró los 3 defectos reales documentados en
   `tests/qa/test-execution-report.md`; la capa de Playwright existe para que
   esa clase de fallo deje de depender de que alguien se acuerde de mirar.

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

## Las pruebas de extremo a extremo

**Qué cubren y qué no.** Son cinco recorridos, no un catálogo exhaustivo: entrar
y navegar, la vida de un equipo (alta, entrega, reparación y baja), el cambio de
empresa y la descarga de reportes. Lo que se comprueba aquí es lo que solo se
rompe cuando las piezas se juntan; el detalle de cada regla —qué ve cada rol,
qué valida cada formulario— sigue estando donde es más barato comprobarlo, en
pytest y en Vitest. Duplicarlo aquí costaría minutos por ejecución y no
encontraría nada nuevo.

**No levantan los servidores.** Usan los que ya están corriendo. Arrancarlos
desde la suite se llevaría por delante los del entorno de trabajo, que es donde
se está mirando la aplicación mientras se programa. Si alguno no responde, la
preparación lo dice y se detiene.

**La cuenta de pruebas se crea y se borra en cada ejecución**, con una
contraseña distinta cada vez: una credencial fija en el repositorio acaba, antes
o después, en una base que no es la de pruebas. Si un Ctrl+C interrumpe el
cierre, `verificar_despliegue` avisa de las cuentas que empiezan por `e2e_`.

**Lo que crean, lo retiran.** Los equipos que registran llevan el prefijo `E2E-`
y se borran al terminar. Un activo no se elimina desde la aplicación —se da de
baja, para no perder su historia—, así que el cierre lo hace por debajo: son
datos que nacieron en una prueba y conservarlos solo ensuciaría el inventario
con el que se trabaja.

**Van una detrás de otra** (`workers: 1`). Comparten una base de datos real, y
dos navegadores creando activos a la vez harían que un listado contara lo del
otro.

**En la primera ejecución encontraron algo**: la migración de depreciación no
estaba aplicada en la base de desarrollo, y eso rompía la ficha de cualquier
activo. Las pruebas de pytest no podían verlo —crean su propia base y aplican
las migraciones al empezar— y las de Vitest tampoco, porque simulan la capa de
servicios. Es exactamente la clase de fallo para la que se añadió esta capa.
