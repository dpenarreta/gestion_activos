Feature: Criterios de aceptación transversales del proyecto
  Como responsable de calidad del sistema Gestión de Activos
  Quiero que la arquitectura, la base de datos y la calidad general del
  proyecto cumplan lo exigido por el prompt de partición
  Para garantizar que el resultado es una base técnica confiable y reutilizable

  # Archivo paraguas exigido por nombre exacto (sección 16.1 del prompt). Los
  # criterios de comportamiento de dominio (autenticación, usuarios, roles,
  # permisos, seguridad, datos personales, branding) viven en sus propios
  # `.feature`, para no duplicar escenarios — ver
  # tests/qa/acceptance-criteria-traceability.md para la relación completa.

  # --- Arquitectura --------------------------------------------------------

  @AC-008
  Scenario: Backend y frontend están separados
    When se inspecciona la estructura de carpetas del repositorio
    Then "backend/" y "frontend/" son proyectos independientes, cada uno con su propio gestor de dependencias

  @AC-009
  Scenario: El backend usa Python y Django
    When se revisan las dependencias del backend
    Then Django es el framework principal, sobre Python 3.12

  @AC-010
  Scenario: El proyecto usa SQL Server
    When se revisa la configuración de base de datos del backend
    Then el motor configurado es SQL Server, vía el backend "mssql" (mssql-django + pyodbc)

  @AC-011
  Scenario: El backend mantiene el patrón Modelo Vista Template
    When se revisa la organización de cada app del backend
    Then existen modelos, serializers/vistas (controladores) y, donde corresponde, templates de Django
    And la lógica de negocio vive en una capa de servicios, no en las vistas

  @AC-012
  Scenario: El frontend usa React
    When se revisan las dependencias del frontend
    Then React es la biblioteca principal de interfaz

  @AC-013
  Scenario: Node.js administra las dependencias del frontend
    When se revisa el frontend
    Then usa "package.json"/npm sobre Node.js para instalar y construir el proyecto

  @AC-014
  Scenario: Bootstrap es el framework visual principal
    When se revisan los estilos del frontend
    Then Bootstrap 5 y Bootstrap Icons son la base visual de todos los componentes

  @AC-015
  Scenario: Templates y estilos están separados
    When se revisa el código del frontend
    Then cada componente tiene su propio archivo de estilos, sin estilos embebidos extensos en el JSX

  # --- Base de datos -------------------------------------------------------

  @AC-040
  Scenario: Las migraciones funcionan con SQL Server
    Given una instancia de SQL Server real disponible (contenedor Docker)
    When se ejecuta "manage.py migrate" desde cero
    Then todas las migraciones se aplican sin error

  @AC-041
  Scenario: Existen relaciones válidas entre usuarios, roles y permisos
    When se inspeccionan las tablas creadas
    Then las relaciones usuario-rol (grupos) y rol-permiso están correctamente definidas como claves foráneas

  @AC-042
  Scenario: Se aplican restricciones de unicidad
    When se inspeccionan los campos de usuario y de tokens
    Then "username", "email" y los identificadores de token tienen restricción de unicidad a nivel de base de datos

  @AC-043
  Scenario: No existen datos productivos dentro del repositorio
    When se revisan las migraciones de datos versionadas
    Then solo siembran la identidad institucional por defecto, nunca usuarios, clientes ni datos reales

  @AC-044
  Scenario: La creación del administrador no usa una contraseña fija
    When se crea el primer superusuario
    Then se usa el comando nativo "createsuperuser" de Django (interactivo o con una contraseña generada), nunca un valor fijo en el código

  # --- Calidad y documentación --------------------------------------------

  @AC-045
  Scenario: El backend inicia correctamente
    When se ejecuta el servidor de desarrollo de Django
    Then responde exitosamente en "/api/v1/health/"

  @AC-046
  Scenario: El frontend inicia correctamente
    When se ejecuta el servidor de desarrollo de Vite
    Then la aplicación carga en el navegador sin errores de consola

  @AC-047
  Scenario: El frontend genera un build de producción correctamente
    When se ejecuta "npm run build"
    Then el proceso termina sin errores y genera los artefactos en "dist/"

  @AC-048
  Scenario: Las pruebas de backend están documentadas
    When se revisa la carpeta de pruebas de cada app del backend
    Then existen pruebas automatizadas con pytest para autenticación, usuarios, roles, permisos y branding

  @AC-049
  Scenario: Las pruebas de frontend están documentadas
    When se revisa la carpeta "frontend/tests/"
    Then existen pruebas automatizadas con Vitest para el login, el guardado de rutas y las páginas administrativas clave

  @AC-050
  Scenario: Las pruebas de integración están documentadas
    When se revisan los escenarios Gherkin y sus step definitions
    Then existen pruebas de integración que ejercitan el flujo HTTP completo (login, refresh, CRUD administrativo)

  @AC-051
  Scenario: Cada criterio de aceptación tiene un escenario Gherkin
    When se revisa la matriz de trazabilidad
    Then cada AC-xxx de este prompt está asociado a al menos un escenario en un archivo ".feature"

  @AC-052
  Scenario: Cada escenario Gherkin tiene trazabilidad
    When se revisa "tests/qa/acceptance-criteria-traceability.md"
    Then cada escenario está vinculado a su identificador de criterio, su archivo y si está automatizado

  @AC-053
  Scenario: Los resultados de ejecución están documentados
    When se revisa "tests/qa/test-execution-report.md"
    Then cada escenario ejecutado indica su resultado real, sin marcar como aprobado lo que no se ejecutó

  @AC-054
  Scenario: El README refleja la estructura final
    When se revisa "README.md"
    Then describe la arquitectura, instalación, pruebas y despliegue realmente presentes en el repositorio

  @AC-055
  Scenario: Existe documentación técnica en docs/
    When se revisa la carpeta "docs/"
    Then existen documentos de arquitectura, autenticación, roles y permisos, base de datos, API, seguridad, protección de datos, migración y estrategia de QA

  @AC-056
  Scenario: No existen imports ni rutas huérfanas
    When se ejecuta el linter de backend (ruff) y de frontend (eslint)
    Then ambos terminan sin errores de imports no utilizados o rutas rotas

  @AC-057
  Scenario: No existen dependencias innecesarias confirmadas
    When se revisan "requirements/*.txt" y "package.json"
    Then cada dependencia listada es utilizada por código presente en el repositorio
