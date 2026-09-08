Feature: Generación e impresión de etiquetas de activos (RF-08)
  Como personal de bodega
  Quiero obtener la etiqueta de un activo en PDF o enviarla a una impresora térmica
  Para que el etiquetado resista el calor, el roce y la limpieza de los equipos

  Background:
    Given que existe un activo con código de barras asignado

  @AC-ETI-001
  Scenario: La etiqueta contiene código de barras, nombre del activo y área
    When se genera el trabajo de impresión térmica del activo
    Then el contenido incluye el código de barras en simbología Code 128
    And incluye el nombre del activo y el nombre de su área

  @AC-ETI-008
  Scenario: La etiqueta se descarga en PDF
    When se descarga la etiqueta del activo
    Then se obtiene un documento PDF
    And el archivo se nombra con el código de barras del activo

  @AC-ETI-009
  Scenario: El PDF conserva el tamaño físico de la etiqueta
    When se genera la etiqueta en PDF
    Then la página mide lo mismo que la etiqueta física
    # Así "imprimir a tamaño real" sale a escala y no reescalado a A4.

  @AC-ETI-010
  Scenario: La etiqueta se puede revisar antes de imprimirla
    When se solicita la vista previa de la etiqueta
    Then el PDF se entrega para mostrarse en el visor, sin descargarse

  @AC-ETI-002
  Scenario: Se admiten los dos lenguajes de impresión térmica directa
    When se solicita la etiqueta en formato ZPL
    Then se obtiene un trabajo de impresión delimitado por los comandos de ZPL
    When se solicita la etiqueta en formato TSPL
    Then se obtiene un trabajo de impresión con los comandos de TSPL

  @AC-ETI-003
  Scenario: Un lenguaje no soportado se rechaza con un mensaje claro
    When se solicita la etiqueta en un formato desconocido
    Then la respuesta indica cuáles son los formatos admitidos

  @AC-ETI-004
  Scenario: Los datos del activo no pueden inyectar comandos de impresión
    Given un activo cuyo nombre contiene caracteres de control del lenguaje
    When se genera su etiqueta
    Then el trabajo resultante contiene una sola etiqueta bien delimitada

  @AC-ETI-005
  Scenario: Se pueden imprimir etiquetas de varios activos en un solo trabajo
    When se solicitan las etiquetas de dos activos
    Then se obtiene un único trabajo con las dos etiquetas concatenadas

  @AC-ETI-006
  Scenario: La etiqueta se puede descargar como archivo para la cola de impresión
    When se solicita la descarga de la etiqueta
    Then se entrega como archivo adjunto nombrado con el código del activo

  @AC-ETI-007
  Scenario: Imprimir etiquetas exige su propio permiso
    Given un usuario que solo puede ver el inventario
    When intenta generar una etiqueta
    Then la operación es rechazada por falta de permiso
