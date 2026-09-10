Feature: Copias de seguridad y recuperación (§21 del documento funcional)
  Como responsable del sistema
  Quiero poder volver atrás cuando algo se pierde
  Para que un incidente no borre el inventario y sus papeles

  @AC-BAK-001
  Scenario: El respaldo incluye los adjuntos, no solo la base
    When se ejecuta el respaldo
    Then se empaquetan también los archivos adjuntos
    # Facturas y actas firmadas viven en el sistema de archivos y no se
    # regeneran: un respaldo que solo lleve la base deja el inventario intacto
    # y todos sus papeles perdidos.

  @AC-BAK-002
  Scenario: Un respaldo que no se escribió no se informa como correcto
    Given una orden de respaldo que no llega a escribir el archivo
    When termina el comando
    Then falla en vez de informar éxito
    # Fue el defecto real: la ruta iba como parámetro, SQL Server no los admite
    # ahí, y la sentencia no escribía nada ni lanzaba error. Un respaldo así se
    # descubre roto el día que hace falta.

  @AC-BAK-003
  Scenario: El respaldo se verifica antes de darlo por bueno
    When se ejecuta el respaldo
    Then el archivo se comprueba con una verificación de integridad

  @AC-BAK-004
  Scenario: Cada respaldo lleva un manifiesto de lo que contenía
    When se ejecuta el respaldo
    Then queda registrado cuántos activos, adjuntos y movimientos había
    # Restaurar sin comparar contra algo es confiar en que el archivo estaba
    # completo.

  @AC-BAK-005
  Scenario: La comparación detecta una restauración incompleta
    Given una base restaurada con menos registros que el manifiesto
    When se comparan
    Then se señalan las diferencias
    # Un respaldo truncado se restaura sin ruido y el hueco se descubre meses
    # después, cuando alguien busca un acta que no está.

  @AC-BAK-006
  Scenario: La ruta del respaldo se valida antes de usarla
    When la ruta contiene comillas o punto y coma
    Then se rechaza
    # Va embebida en la sentencia SQL porque `TO DISK` no admite parámetros.

  @AC-BAK-007
  Scenario: La revisión de despliegue avisa si no hay respaldos
    Given un sistema sin ningún respaldo
    When se ejecuta la verificación previa
    Then se advierte que no hay de dónde volver

  @AC-BAK-008
  Scenario: Un manifiesto corrupto no rompe la revisión
    Given un archivo de manifiesto ilegible
    When se ejecuta la verificación previa
    Then la revisión termina igual e informa
    # Su trabajo es informar, incluso de que algo está mal.
