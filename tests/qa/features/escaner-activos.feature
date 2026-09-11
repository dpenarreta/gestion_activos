Feature: Consulta por lectura de código de barras (RF-03)
  Como técnico de soporte en inspección de campo
  Quiero escanear la etiqueta de un equipo y ver su información al instante
  Para no tener que escribir a mano el número de serie

  @AC-ESC-001
  Scenario: Escanear un código muestra ficha, responsable e historial completo
    Given que existe un activo con mantenimientos y movimientos registrados
    When se consulta el activo por el código de barras escaneado
    Then se obtiene su ficha técnica y el usuario asignado
    And se obtiene el historial de movimientos de custodia
    And se obtiene la bitácora de mantenimientos con sus costos

  @AC-ESC-002
  Scenario: El escáner también resuelve por número de serie
    Given que existe un activo registrado
    When se consulta usando el número de serie del fabricante en vez del código propio
    Then se obtiene el mismo activo
    # El técnico no siempre sabe si lee nuestra etiqueta o la del fabricante.

  @AC-ESC-003
  Scenario: Un código inexistente informa con claridad
    When se consulta un código que no corresponde a ningún activo
    Then la respuesta indica que ningún activo corresponde a ese código

  @AC-E2E-010
  Scenario: Una lectura ofrece las dos cosas que se hacen con el equipo en la mano
    Given una etiqueta leída con la pistola
    When aparece el equipo
    Then se ofrece ver su ficha o registrar un mantenimiento sobre él
    And el formulario de mantenimiento llega con el equipo ya elegido
    # Entrar a la ficha para buscar ahí dentro el botón de registrar es un
    # rodeo justo cuando el técnico tiene el aparato delante y una avería que
    # apuntar.

  @AC-E2E-011
  Scenario: No se ofrece registrar sobre un equipo que salió del parque
    Given un equipo dado de baja, perdido o robado
    When se lee su etiqueta
    Then se puede ver su ficha, pero no registrar un mantenimiento
    # El backend rechaza la intervención, y el estado está junto al nombre para
    # que se vea por qué no se ofrece.
