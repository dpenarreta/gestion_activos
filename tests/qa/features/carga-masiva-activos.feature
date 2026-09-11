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

  @AC-IMP-011
  Scenario: Las columnas de la plantilla se configuran desde el panel
    When se desactiva una columna opcional
    Then deja de aparecer en la plantilla descargada
    And su valor deja de leerse al importar

  @AC-IMP-012
  Scenario: Una columna opcional se puede volver obligatoria
    When se marca como obligatoria una columna que no lo era
    Then las filas que la dejen vacía se reportan como error

  @AC-IMP-013
  Scenario: Renombrar una columna cambia el encabezado y lo que se lee
    When se cambia la etiqueta de una columna
    Then la plantilla sale con el nuevo encabezado
    And el archivo llenado con ese encabezado se sigue leyendo
    # El generador y el lector toman la etiqueta del mismo sitio: si cada uno
    # tuviera la suya, renombrar produciría archivos ilegibles.

  @AC-IMP-014
  Scenario: Se pueden pedir datos propios sin cambiar la base de datos
    When se agrega una columna de característica propia
    Then aparece en la plantilla
    And lo capturado se guarda dentro de las especificaciones del activo

  @AC-IMP-015
  Scenario: Las columnas imprescindibles no se pueden quitar
    When se intenta desactivar, volver opcional o eliminar el tipo, el nombre,
      la serie, el departamento o la fecha de adquisición
    Then la operación es rechazada
    # Sin esos datos no se puede crear un activo: permitir quitarlas no daría
    # flexibilidad, daría un archivo que siempre falla.

  @AC-IMP-016
  Scenario: Configurar la plantilla exige permiso de edición
    Given un usuario que puede ver y cargar activos, pero no editarlos
    When intenta cambiar una columna de la plantilla
    Then la operación es rechazada
    # Quien carga inventario no debería poder cambiar qué se le exige al resto.

  @AC-IMP-017
  Scenario: Nombrar al partner basta para que el equipo sea suyo
    Given la plantilla con las columnas de propiedad habilitadas
    When se carga una fila que nombra a un concesionario del catálogo
    Then el equipo queda en concesión y a nombre de ese partner
    # Pedir además la otra columna sería hacer escribir dos veces lo mismo.

  @AC-IMP-018
  Scenario: Decir las dos cosas a la vez se señala en vez de resolverse solo
    When una fila dice que el equipo es de la empresa y a la vez nombra a un partner
    Then la carga es rechazada señalando la contradicción
    # En el formulario el campo se oculta y el resto se limpia en silencio;
    # aquí las dos columnas están a la vista y llenas a mano, así que lo que
    # hay es una contradicción, no un resto de un campo que se ocultó.

  @AC-IMP-019
  Scenario: Varios responsables en una celda, separados por punto y coma
    When una fila lleva dos códigos de empleado en «Código del custodio»
    Then el equipo queda compartido y a nombre de los dos
    # Nombrar a varios ya dice que el equipo es de varios: pedir además la otra
    # columna sería hacer escribir dos veces lo mismo.
