Feature: Inventario y expediente de activos electrónicos (RF-01, RF-02)
  Como responsable del parque tecnológico
  Quiero centralizar el expediente de cada dispositivo con un identificador único
  Para eliminar las hojas de cálculo dispersas y saber quién responde por cada equipo

  Background:
    Given que existen un departamento, un empleado y un tipo de dispositivo registrados

  @AC-ACT-001
  Scenario: El expediente captura ficha técnica, responsable y área
    When se registra un activo con marca, modelo, número de serie, especificaciones, custodio y departamento
    Then el activo queda almacenado con todos esos datos
    And aparece en el inventario consultable

  @AC-ACT-002
  Scenario: El alta genera un código de barras único automáticamente
    When se registra un activo nuevo
    Then el sistema le asigna un código de barras sin intervención del usuario
    And el código sigue el formato de prefijo, tipo y secuencia
    And ningún otro activo puede tener ese mismo código

  @AC-ACT-003
  Scenario: La numeración es correlativa e independiente por tipo de dispositivo
    Given que ya existe una laptop registrada con el primer código de su tipo
    When se registran una segunda laptop y la primera impresora
    Then la segunda laptop recibe el segundo correlativo de las laptops
    And la primera impresora recibe el primer correlativo de las impresoras

  @AC-ACT-004
  Scenario: El número de serie no se puede duplicar
    Given que existe un activo con un número de serie registrado
    When se intenta registrar otro activo con el mismo número de serie
    Then la solicitud es rechazada

  @AC-ACT-005
  Scenario: Asignar un custodio deja traza en el historial
    When se asigna el activo a un empleado
    Then el activo queda en uso a nombre de ese empleado
    And se registra un movimiento de asignación con el responsable anterior y el nuevo

  @AC-ACT-006
  Scenario: Devolver un equipo conserva el rastro de quién lo tenía
    Given que el activo está asignado a un empleado
    When se devuelve el activo a bodega
    Then el activo queda sin custodio y en bodega
    And el movimiento de devolución conserva el custodio anterior

  @AC-ACT-007
  Scenario: Un activo se da de baja, nunca se elimina
    When se intenta eliminar un activo del inventario
    Then la operación es rechazada
    And el activo sigue existiendo con su expediente completo

  @AC-ACT-008
  Scenario: Dar de baja exige un motivo
    When se intenta dar de baja un activo sin indicar el motivo
    Then la solicitud es rechazada
    And al indicar el motivo la baja se registra con su fecha

  @AC-ACT-009
  Scenario: La edición de la ficha no puede cambiar al responsable
    When se edita la ficha técnica enviando también un custodio distinto
    Then los datos técnicos se actualizan
    But el custodio no cambia, porque hacerlo exige la acción que deja el movimiento

  @AC-ACT-010
  Scenario: No se puede desactivar a un empleado que aún custodia equipos
    Given que un empleado tiene activos bajo su custodia
    When se intenta desactivar a ese empleado
    Then la operación es rechazada indicando cuántos activos debe reasignar primero

  @AC-ACT-030
  Scenario: Se registra si el equipo se compró nuevo o usado
    When se da de alta un equipo adquirido de segunda mano
    Then queda registrado como usado, y así se lee en su ficha
    # Un equipo usado llega con parte de su vida ya gastada: sus mismos meses
    # de antigüedad no significan lo mismo que los de uno comprado nuevo.

  @AC-ACT-031
  Scenario: No decirlo es una respuesta válida
    When se da de alta un equipo sin indicar su condición
    Then se guarda sin ella y la ficha dice «sin especificar»
    # El levantamiento inicial se hace con equipos cuya procedencia ya nadie
    # recuerda, y dar «nuevo» por supuesto sería inventarla.

  @AC-ACT-032
  Scenario: La condición no se confunde con el estado
    Given un equipo comprado usado
    When se lo da de baja
    Then cambia su estado y conserva su condición
    # El nombre se parece, pero `estado` cambia cada vez que el equipo se
    # mueve y la condición es de la compra: ya no cambia.
