Feature: Partición controlada del repositorio original
  Como arquitecto responsable de la partición
  Quiero que skelleton_base se publique de forma limpia y verificable
  Para que sea una plantilla reutilizable, sin rastros del proyecto original
  ni acciones destructivas sobre él

  # Estos escenarios documentan hechos sobre el propio proceso de partición y
  # el estado del repositorio — se verifican por inspección directa del
  # repositorio y su historial de Git, no mediante pytest (ver
  # tests/qa/test-execution-report.md para el detalle de cómo se verificó
  # cada uno).

  @AC-001
  Scenario: El repositorio destino fue clonado desde la URL correcta
    Given el repositorio remoto "https://github.com/dpenarreta/skelleton_base"
    When se clona localmente
    Then el directorio de trabajo corresponde a ese repositorio

  @AC-002
  Scenario: El remoto "origin" apunta al repositorio indicado
    Given el repositorio clonado localmente
    When se ejecuta "git remote -v"
    Then "origin" apunta exactamente a "https://github.com/dpenarreta/skelleton_base"

  @AC-003
  Scenario: El repositorio original no fue modificado destructivamente
    Given el repositorio original "skelleton"
    When se completa la partición
    Then su historial y su rama de trabajo permanecen intactos
    And existe una rama de respaldo local "backup/pre-skelleton-base-partition"

  @AC-004
  Scenario: No se utilizaron comandos de sobrescritura forzada
    When se revisan los comandos de Git ejecutados durante la partición
    Then ninguno usa "push --force" ni "reset --hard" sobre el repositorio destino

  @AC-005
  Scenario: Los módulos de negocio fueron excluidos
    Given el inventario de módulos del proyecto original
    When se compara con el contenido de skelleton_base
    Then no aparecen los módulos de media, formularios, avisos, páginas, footer ni menús dinámicos

  @AC-006
  Scenario: Solo permanecen los módulos base autorizados
    When se listan las apps del backend de skelleton_base
    Then son exactamente: core, authentication, users, roles, permissions y branding

  @AC-007
  Scenario: No existen referencias funcionales innecesarias al proyecto original
    When se busca el texto "skeleton" (nombre del proyecto original) en el código fuente de skelleton_base
    Then no aparece en configuración funcional activa (solo, a lo sumo, en comentarios históricos explicativos)

  @AC-025
  Scenario: No existen credenciales reales versionadas
    When se revisan los archivos rastreados por Git
    Then ningún ".env" real está versionado
    And no hay claves, contraseñas ni tokens reales en el código o la documentación

  @AC-026
  Scenario: Existen archivos .env.example seguros
    When se revisan la raíz del repositorio y "backend/"
    Then cada uno tiene un ".env.example" con valores de ejemplo, nunca reales
