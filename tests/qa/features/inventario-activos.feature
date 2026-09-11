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

  @AC-ACT-033
  Scenario: Se distingue lo que compró la empresa de lo que pone un partner
    Given un concesionario registrado en el catálogo
    When se da de alta un equipo marcándolo en concesión y eligiendo a ese partner
    Then la ficha dice «En concesión» y de quién es
    # No es lo mismo que tener proveedor: al proveedor se le compró el equipo,
    # y entonces el equipo sí es de la empresa. El concesionario es su dueño;
    # lo pone para operar con nosotros, la compra corre por su cuenta y el
    # mantenimiento por la nuestra.

  @AC-ACT-034
  Scenario: «En concesión» sin decir de quién no se acepta
    When se marca un equipo en concesión sin elegir al partner
    Then el alta es rechazada pidiendo de qué partner es
    # Sin el dueño, «en concesión» no responde ni a qué hay que devolver ni a
    # quién, que es para lo único que sirve la distinción.

  @AC-ACT-035
  Scenario: Un equipo en concesión no deprecia contra el patrimonio propio
    Given un equipo en concesión con costo y política de depreciación
    When se consulta su valor en libros
    Then no se calcula ninguno, porque la compra fue del partner
    # Contarlo abultaría el valor del parque con algo que es de otro. Sus
    # reparaciones sí son gasto propio y se siguen contando donde toca.

  @AC-ACT-036
  Scenario: El inventario responde qué hay que devolverle a cada partner
    Given equipos propios y equipos de un concesionario
    When se filtra el inventario por propiedad «en concesión»
    Then solo aparecen los del partner
    # Es la pregunta que se hace al cerrar una concesión, y también la que
    # separa lo que sí es patrimonio de la empresa.

  @AC-ACT-040
  Scenario: De un equipo de turno responde más de una persona
    Given un equipo marcado como compartido
    When se le asignan tres responsables
    Then los tres responden por él, y ninguno figura por encima de los otros
    # Un escáner de andén o una impresora de mostrador los usa el turno entero:
    # no hay un titular con acompañantes.

  @AC-ACT-041
  Scenario: La responsabilidad de un equipo personal no se reparte
    Given un equipo que no está marcado como compartido
    When se intenta dejarle dos responsables
    Then la operación es rechazada
    # Repartir la responsabilidad de una laptop entre tres nombres es lo que
    # hace que después nadie responda por ella: la marca es una decisión.

  @AC-ACT-042
  Scenario: Cada responsable firma su propia acta
    Given un equipo compartido
    When se suma a una persona al turno
    Then queda un movimiento a su nombre, del que sale su acta
    # De cada movimiento sale un acta, y en un equipo compartido no hay un
    # titular que pueda firmar por los demás.

  @AC-ACT-043
  Scenario: Que se vaya uno del turno no devuelve el equipo a bodega
    Given un equipo compartido con tres responsables
    When se quita a uno
    Then los otros dos siguen respondiendo y el equipo sigue en uso

  @AC-ACT-044
  Scenario: El equipo aparece en la pantalla de cada uno de sus responsables
    Given un equipo compartido entre dos personas
    When cada una consulta «mis equipos»
    Then las dos lo ven, y cada una ve con quién más lo comparte
    # Si solo apareciera en la pantalla de uno, los demás no sabrían que
    # también responden por él.

  @AC-ACT-045
  Scenario: El informe por usuario lista el equipo bajo cada responsable
    Given un equipo compartido entre dos personas
    When se genera «Activos por usuario»
    Then aparece en la sección de las dos
    # Salir solo en la del primero por apellido dejaría el informe respondiendo
    # a medias la única pregunta que tiene.

  @AC-ACT-046
  Scenario: La alerta de custodio inactivo nombra a quien se fue
    Given un equipo compartido en el que uno de los responsables está dado de baja
    When se consulta el centro de alertas
    Then se nombra solo a esa persona
    # El resto sigue respondiendo: lo que hay que arreglar es quitarlo de la
    # lista, no reasignar el equipo entero.

  @AC-ACT-047
  Scenario: La entrega deja el equipo donde se lo entregó
    When se entrega un equipo indicando la sede
    Then queda a nombre de quien lo recibe y en esa sede
    # Entregar un equipo suele ser ponerlo donde trabaja quien lo recibe, y
    # registrar el traslado aparte dejaba la ubicación desactualizada hasta que
    # alguien se acordara. Sigue siendo una asignación: lo que cambió de manos
    # es el equipo, y el sitio vino con él.

  @AC-ACT-048
  Scenario: Dejar el equipo sin responsable se avisa antes de confirmar
    Given un equipo entregado
    When se quita a quien responde por él
    Then se avisa de que quedará sin responsable y volverá a bodega
    # Quien devuelve un equipo lo sabe; quien quita a la última persona de un
    # turno, no siempre. Descubrirlo después en la ficha es peor que leerlo
    # antes de confirmar.

  @AC-ACT-049
  Scenario: El área no se pregunta en la entrega, pero se dice cuál será
    When se elige a quien recibe el equipo
    Then el formulario dice a qué área quedará adscrito, sin pedirla
    # Es la de quien lo recibe, así que preguntarla sería pedir dos veces el
    # mismo dato. Cambiarla sin decirlo sería peor: un dato que cambia sin que
    # nadie lo vea es un dato que nadie corrige cuando está mal.
