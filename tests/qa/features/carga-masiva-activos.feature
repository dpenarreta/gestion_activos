Feature: Carga masiva de activos desde hoja de cálculo
  Como responsable del parque tecnológico
  Quiero cargar muchos activos de una vez desde un archivo Excel
  Para no capturar uno por uno el inventario que ya existe en hojas de cálculo

  @AC-IMP-001
  Scenario: El sistema entrega una plantilla lista para llenar
    When se descarga la plantilla de carga masiva
    Then se obtiene un archivo .xlsx con las columnas que se deben completar
    And trae instrucciones, un ejemplo y los códigos vigentes de tipos, áreas y empleados

  @AC-IMP-002
  Scenario: La hoja de captura no exige borrar nada antes de usarla
    When se descarga la plantilla
    Then la hoja de activos solo tiene los encabezados
    # Filas de ejemplo dentro de la hoja de datos producirían activos basura
    # si alguien olvida borrarlas.

  @AC-IMP-003
  Scenario: La plantilla descargada se puede llenar y cargar sin ajustes
    Given la plantilla descargada del sistema
    When se completa una fila y se sube el archivo
    Then no se reporta ningún error de formato

  @AC-IMP-004
  Scenario: Subir el archivo no guarda nada todavía
    When se sube un archivo con activos válidos
    Then se muestra un reporte de lo que se importaría
    But el inventario no cambia hasta que se confirme

  @AC-IMP-005
  Scenario: Los errores se informan con su fila y su columna
    When se sube un archivo con datos inválidos
    Then cada error indica en qué fila y en qué columna está
    And explica qué se debe corregir

  @AC-IMP-006
  Scenario: Un archivo con errores no importa ninguna fila
    Given un archivo con filas válidas y filas con error
    When se intenta confirmar la importación
    Then no se crea ningún activo
    # Todo o nada: un inventario a medio cargar es peor que uno vacío, porque
    # nadie sabe cuál de los dos casos está mirando.

  @AC-IMP-007
  Scenario: Un número de serie repetido se detecta antes de importar
    When se sube un archivo con una serie duplicada
    Then se señala si el duplicado está dentro del archivo o ya en el inventario

  @AC-IMP-008
  Scenario: Los activos importados reciben su código de barras
    When se confirma la importación de un archivo válido
    Then cada activo se crea con su código de barras generado por el sistema
    And queda registrado su movimiento de alta

  @AC-IMP-009
  Scenario: La carga masiva queda auditada
    When se confirma una importación
    Then el registro de auditoría guarda cuántos activos se crearon y con qué códigos

  @AC-IMP-010
  Scenario: Cargar masivamente exige el permiso de registrar activos
    Given un usuario que solo puede ver el inventario
    When intenta descargar la plantilla o subir un archivo
    Then la operación es rechazada por falta de permiso
