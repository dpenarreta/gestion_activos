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
    When se cambian los días o las horas del respaldo
    Then el cambio surte efecto sin tocar el programador de tareas
    # El programador es infraestructura: quien decide cuándo hay que respaldar
    # no tiene acceso a él. La tarea corre cada cinco minutos, siempre igual, y
    # la aplicación decide si toca.

  @AC-BAK-010
  Scenario: Solo respalda cuando toca
    Given el respaldo automático configurado a una hora
    When la tarea corre antes de esa hora
    Then no respalda, y dice por qué
    But pasada la hora, respalda una sola vez por turno
    # La tarea pasa cada cinco minutos: sin anotar el último turno cubierto,
    # haría un respaldo por pasada desde la hora configurada.

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

  @AC-BAK-016
  Scenario: Configurar el respaldo es su propio permiso
    Given un usuario que puede editar la configuración del sistema
    When intenta cambiar la política de respaldo sin el permiso de respaldos
    Then el sistema lo rechaza y la política queda como estaba
    And leer cuándo fue el último respaldo le sigue bastando con ver la configuración
    # Cambiar el logo y los colores no debería decidir de cuándo se puede
    # volver si algo se pierde. Quien ya tenía `configuracion.editar` conserva
    # los dos permisos: la migración se lo concede, para que nadie pierda de
    # un día para otro algo que venía haciendo.

  # --- Horario personalizable (14 de octubre de 2026) ------------------------
  #
  # La hora configurada no era la hora a la que ocurría: se leía en UTC —«02:30»
  # eran las 21:30 en Ecuador— y la tarea solo miraba a los cinco minutos de
  # cada hora. Y solo había «diario» o «un día por semana», a una hora.

  @AC-BAK-017
  Scenario: La hora configurada es la hora local
    Given el respaldo configurado a las 02:30
    Then se hace a las 02:30 de Ecuador, no a las 02:30 UTC
    And la pantalla muestra el próximo en esa misma hora

  @AC-BAK-018
  Scenario: Varios días y varias horas
    Given el respaldo de lunes a viernes a las 13:00 y a las 22:00
    Then se hace un respaldo en cada turno de esos días y ninguno el fin de semana
    And si el equipo estuvo apagado en los dos turnos, al volver se hace uno solo
    # Dos respaldos seguidos con el mismo contenido solo ocupan disco.

  @AC-BAK-019
  Scenario: Respaldar ahora desde la pantalla
    When alguien con el permiso de respaldos pulsa «Respaldar ahora»
    Then la tarea respalda en su siguiente pasada, aunque el automático esté apagado
    And pedirlo dos veces antes de que empiece no hace dos respaldos
    And queda auditado quién lo pidió
    # La petición web no respalda: un respaldo tarda minutos, y el navegador o
    # el proxy cortarían la espera con el respaldo a medias.

  @AC-BAK-020
  Scenario: Un respaldo fallido se ve en la pantalla
    Given un respaldo que no pudo completarse
    Then la pantalla dice que el último falló y por qué
    # Docker apagado o el disco lleno fallan todas las noches en silencio si el
    # único rastro es la salida de la tarea.

  @AC-BAK-021
  Scenario: Un horario imposible se rechaza
    When se guarda un horario sin días, sin horas, con más de ocho horas o con una hora mal escrita
    Then el sistema lo rechaza y dice por qué

  # --- Borrar respaldos (14 de octubre de 2026) ------------------------------
  #
  # Las copias de la base pesan decenas de megas y se acumulaban: la retención
  # no tocaba los `.bak`, y en un mes eran 29 y más de 600 MB.

  @AC-BAK-022
  Scenario: Los respaldos en disco se ven en la pantalla
    When se abre la configuración de respaldos
    Then se listan los respaldos del más reciente al más antiguo
    And de cada uno se ve la fecha, si incluye la base y los adjuntos, qué contenía y cuánto pesa
    # Incluidos los `.bak` sin manifiesto, de antes de que hubiera retención:
    # si no se ven, no se pueden borrar.

  @AC-BAK-023
  Scenario: Borrar un respaldo lo quita entero y queda auditado
    Given alguien con el permiso de respaldos
    When borra un respaldo y lo confirma
    Then se borran la copia de la base, los adjuntos y el manifiesto
    And queda registrado quién lo borró y qué contenía
    # Dejar una parte haría creer que hay de dónde volver.

  @AC-BAK-024
  Scenario: El respaldo más reciente no se puede borrar
    Then su botón de borrar aparece deshabilitado, con el motivo escrito al lado
    And el servidor rechaza el borrado aunque se pida sin pasar por el botón
    # Es el único que garantiza que hoy hay de dónde volver.

