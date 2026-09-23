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

  # --- Respaldo programado (17 de septiembre de 2026) -----------------------
  #
  # Hasta ahora el respaldo existía y había que acordarse de lanzarlo. Un
  # respaldo que depende de que alguien se acuerde no es una copia de
  # seguridad: es una intención.

  @AC-BAK-009
  Scenario: El cuándo se decide en la aplicación, no en el servidor
    When se cambia la frecuencia del respaldo a semanal
    Then el cambio surte efecto sin tocar el programador de tareas
    # El programador es infraestructura: quien decide cada cuánto hay que
    # respaldar no tiene acceso a él, y cambiar «semanal» por «diaria» no
    # debería necesitar un administrador de servidores. La tarea corre cada
    # hora, siempre igual, y la aplicación decide si toca.

  @AC-BAK-010
  Scenario: Solo respalda cuando toca
    Given el respaldo automático configurado a una hora
    When la tarea corre antes de esa hora
    Then no respalda, y dice por qué
    But pasada la hora, respalda una sola vez ese día
    # La tarea corre cada hora: sin anotar el último, haría un respaldo por hora
    # desde las dos de la mañana.

  @AC-BAK-011
  Scenario: Apagado no respalda nada
    When el respaldo automático está apagado
    Then la tarea no escribe nada y lo dice
    And el comando sigue estando para lanzarlo a mano

  @AC-BAK-012
  Scenario: Los respaldos viejos se retiran
    Given más respaldos de los que se pidió conservar
    When se hace uno nuevo
    Then se retiran los más antiguos con todos sus archivos
    # Sin esto el disco se llena, y el respaldo empieza a fallar justo cuando
    # más falta hace.

  @AC-BAK-013
  Scenario: Un respaldo a mano no cuenta como el programado
    When alguien lanza un respaldo de prueba un martes
    Then el programado del miércoles se hace igual
    # Si contara, saltarse un día programado sería tan fácil como probar el
    # comando, y nadie lo notaría.

  @AC-BAK-014
  Scenario: La pantalla dice cuándo fue el último y cuándo es el próximo
    When se abre la configuración de respaldos
    Then muestra de cuándo se puede volver y cuándo toca el siguiente
    # Es la comprobación que se hace después de cambiar la frecuencia: sin eso
    # hay que esperar al día siguiente para saber si quedó bien configurado.

  @AC-BAK-015
  Scenario: Cambiar la política queda auditado
    When alguien apaga el respaldo automático o cambia su frecuencia
    Then el cambio queda registrado con quién lo hizo
    # Quién dejó de respaldar, y cuándo, es lo primero que se pregunta el día
    # que hace falta volver a algún sitio.
