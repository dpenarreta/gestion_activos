Feature: Panel principal y exportación (§15 y §16 del documento funcional)
  Como supervisor de TI
  Quiero ver el estado del parque de un vistazo y poder llevarme los datos
  Para tomar decisiones y compartirlas fuera del sistema

  @AC-DSH-001
  Scenario: El panel resume el inventario por estado
    When se abre el panel principal
    Then muestra cuántos activos hay en total, asignados, disponibles,
      en reparación, dados de baja y con sugerencia de renovación

  @AC-DSH-002
  Scenario: Cada indicador lleva al listado correspondiente
    When se pulsa un indicador del panel
    Then se abre el inventario ya filtrado por ese criterio
    # Un número suelto solo informa; lo que se quiere es ver cuáles son.

  @AC-DSH-003
  Scenario: El panel informa el costo de mantenimiento
    When se abre el panel principal
    Then muestra el costo del mes y el acumulado, sumando mano de obra y repuestos
    And muestra el volumen de intervenciones de los últimos meses

  @AC-DSH-004
  Scenario: El ranking señala los equipos problemáticos
    When se abre el panel principal
    Then lista los activos con más intervenciones acumuladas
    But omite los que ya fueron dados de baja
    # Un equipo retirado no es un problema a resolver.

  @AC-DSH-005
  Scenario: Los indicadores que no se pueden calcular se declaran
    When se abre el panel principal
    Then los indicadores del documento que aún no son posibles se indican con su motivo
    # Devolver un cero en «garantías vencidas» se leería como «ninguna vencida».

  @AC-EXP-001
  Scenario: El inventario se exporta a Excel
    When se exporta el inventario
    Then se descarga un archivo .xlsx con una fila por activo
    And incluye custodio, área, antigüedad, costos y especificaciones

  @AC-EXP-002
  Scenario: La exportación respeta los filtros de la pantalla
    Given un inventario filtrado por estado
    When se exporta
    Then el archivo contiene solo los activos que coinciden con el filtro
    # Exportar siempre el inventario completo obligaría a filtrar otra vez en Excel.

  @AC-EXP-003
  Scenario: La bitácora de mantenimientos se exporta a Excel
    When se exporta la bitácora
    Then el archivo incluye el desglose de componentes y los costos por intervención

  @AC-EXP-004
  Scenario: Exportar exige un permiso propio
    Given un usuario que puede consultar el inventario pero no exportarlo
    When intenta descargar el archivo
    Then la operación es rechazada
    # Sacar el inventario completo en un archivo que sale del sistema es una
    # acción distinta de consultarlo en pantalla.

  @AC-EXP-005
  Scenario: Cada exportación queda auditada
    When se exporta el inventario
    Then la bitácora registra quién exportó, cuántas filas y con qué filtros
