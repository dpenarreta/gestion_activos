Feature: Solicitudes de compra: lo que falta, no lo que hay
  Como alguien que necesita un equipo que todavía no existe
  Quiero pedirlo y que le llegue a quien lo va a comprar
  Para que la petición deje de vivir en un correo y se pueda saber en qué punto está

  El inventario responde qué hay; esto responde qué falta. Una laptop pedida
  por correo no estaba en ninguna parte hasta que llegaba: nadie podía decir
  cuántas se pidieron, quién las pidió ni en qué punto estaban, y cuando
  alguien preguntaba la respuesta salía de la memoria de quien compra.

  @AC-SOL-001
  Scenario: Una solicitud nace con encargado
    When alguien registra una solicitud
    Then elige a quién le llega, y esa persona la ve en «Solicitudes recibidas»
    # Es lo que hace que la bandeja sea una lista de tareas y no un buzón común
    # donde todos suponen que lo está mirando otro.

  @AC-SOL-002
  Scenario: El solicitante es quien está autenticado
    When el cliente manda un solicitante distinto del suyo
    Then se ignora y la solicitud queda a nombre de quien la registró
    # Si no, se podría pedir en nombre de otro y «Mis solicitudes» dejaría de
    # querer decir lo que dice.

  @AC-SOL-003
  Scenario: Lo que se pide se elige del catálogo
    When se realiza una solicitud desde el formulario
    Then lo que se pide se elige del catálogo de tipos o de componentes
    And elegirlo es lo que trae las características con las que se describe
    # El formulario dejó de ofrecer un texto libre: traía «laptop», «Laptop» y
    # «portátil» para lo mismo, y no traía las características. La API sigue
    # aceptando `detalle` —lo ya pedido así se conserva y se lee—, pero pedir
    # algo que el catálogo no tiene empieza por darlo de alta como tipo, que es
    # donde se declara qué se especifica de él.

  @AC-SOL-004
  Scenario: Una solicitud sin objeto se rechaza
    When no se elige nada del catálogo ni se describe qué se necesita
    Then el sistema la rechaza
    # Hay que devolverla preguntando qué era.

  @AC-SOL-005
  Scenario: No se piden un dispositivo y un componente a la vez
    When una solicitud lleva un tipo de dispositivo y un componente
    Then el sistema la rechaza y pide hacer dos
    # No se sabría si es una compra o dos, y cada una se compra y se entrega
    # por su cuenta.

  @AC-SOL-006
  Scenario: Solo se asigna a quien puede atenderla
    When se elige como encargado a alguien sin permiso para gestionar compras
    Then el sistema lo rechaza
    # Sería dejarla en un buzón que nadie abre: quien no tiene el permiso no ve
    # «Solicitudes recibidas».

  @AC-SOL-007
  Scenario: El catálogo para pedir no exige ver el inventario
    Given alguien que puede pedir pero no ver el parque
    When abre «Realizar solicitud»
    Then los desplegables traen los tipos y los componentes igualmente
    # Por los endpoints del inventario le llegarían vacíos, por un 403 que
    # nadie ve.

  @AC-SOL-008
  Scenario: Mis solicitudes son las que yo pedí
    When se abre «Mis solicitudes»
    Then solo aparecen las registradas por quien pregunta

  @AC-SOL-009
  Scenario: Las recibidas son las que me asignaron
    When se abre «Solicitudes recibidas»
    Then aparecen las asignadas a quien pregunta
    And quien administra compras ve las de todos
    # Es lo que permite ver la que nadie ha tocado en tres semanas.

  @AC-SOL-010
  Scenario: La solicitud de otro no se ve ni existe
    When alguien pide una solicitud en la que no participa
    Then el sistema responde que no existe, no que no puede
    # Quien no participa no tiene por qué enterarse de que existe.

  @AC-SOL-011
  Scenario: Las solicitudes no cruzan empresas
    When la misma persona trabaja en dos empresas
    Then lo pedido en una no se ve desde la otra

  @AC-SOL-012
  Scenario: El recorrido va de pendiente a entregada
    When el encargado la toma, la compra y la entrega
    Then cada paso queda registrado y la solicitud avanza
    # Pendiente → En gestión → Comprada → Entregada, más rechazada y cancelada.

  @AC-SOL-013
  Scenario: Cada paso queda escrito con quién lo dio
    When una solicitud cambia de estado
    Then queda en su recorrido quién lo hizo, cuándo y con qué nota
    # Un recorrido que se puede reescribir no sirve para explicar por qué un
    # área lleva tres meses sin su equipo.

  @AC-SOL-014
  Scenario: Gestionar es gestionar lo propio
    When alguien con permiso de gestionar toca una solicitud que no tiene asignada
    Then el sistema lo rechaza
    # Si no, la bandeja sería un sitio donde cualquiera cierra el pedido de otro.

  @AC-SOL-015
  Scenario: Quien pide no aprueba lo suyo, pero sí lo retira
    When el solicitante intenta marcar su solicitud como comprada
    Then el sistema lo rechaza
    But puede cancelarla mientras no esté cerrada
    # Dejar abierta una solicitud que ya no hace falta le hace perder el tiempo
    # a quien compra.

  @AC-SOL-016
  Scenario: Un rechazo lleva motivo
    When se rechaza una solicitud sin escribir por qué
    Then el sistema lo rechaza
    # Es lo único que le llega a quien pidió como explicación.

  @AC-SOL-017
  Scenario: Una solicitud cerrada no se reabre ni se salta pasos
    When una solicitud ya fue entregada, rechazada o cancelada
    Then no admite más cambios de estado
    And desde «pendiente» no se llega a «comprada» sin pasar por «en gestión»
    # Comprada ya costó dinero: el recorrido cuenta lo que de verdad ocurrió.

  @AC-SOL-018
  Scenario: Lo que se pidió se corrige mientras nadie la haya tomado
    When el solicitante corrige su solicitud todavía pendiente
    Then el cambio se guarda
    But una vez tomada hay que cancelarla y hacer otra
    # Cambiar qué se pide después de que alguien fue a cotizarlo le hace perder
    # el trabajo hecho.

  @AC-SOL-019
  Scenario: Al encargado se le avisa de lo que le asignaron
    When se registra una solicitud
    Then le llega un correo a quien deberá comprarla
    And si su cuenta no tiene correo, se dice en el acto a quien pidió
    # Una bandeja sin aviso es una bandeja que se mira cuando alguien se acuerda.

  @AC-SOL-020
  Scenario: A quien pidió se le avisa de cada paso
    When la solicitud cambia de estado
    Then le llega un correo al solicitante
    But no cuando el paso lo dio él mismo
    # Sería contarle lo que acaba de hacer.

  @AC-SOL-021
  Scenario: Una solicitud no se borra
    When ya no hace falta
    Then se cancela, y queda escrito que se pidió y que se retiró
    # Borrarla haría desaparecer de los conteos lo que un área llegó a
    # necesitar.

  @AC-SOL-022
  Scenario: Se pide con las características que el tipo declara
    When se elige un tipo de dispositivo al realizar la solicitud
    Then el formulario carga las características declaradas para ese tipo
    And lo elegido viaja con la solicitud y se ve en su ficha
    # «Una laptop» y «una laptop con 32 GB y disco NVMe» son dos compras
    # distintas, y la diferencia se perdía en la justificación escrita a mano,
    # donde no se puede filtrar ni comparar con lo que se acabó comprando.

  @AC-SOL-023
  Scenario: Lo que el tipo marca obligatorio se exige también al pedir
    When el tipo declara características obligatorias
    Then la solicitud no se registra sin ellas
    But las que no están marcadas se pueden dejar en blanco
    # Si se declaró que de una laptop siempre se dice la RAM, una solicitud que
    # no la diga es una que habrá que devolver preguntando. Lo que no deba
    # exigirse al pedir se desmarca en la característica, y entonces no se exige
    # ni al pedir ni al registrar el equipo.

  @AC-SOL-024
  Scenario: Lo pedido se comprueba contra lo declarado
    When se manda una característica que el tipo no describe
    Then el sistema la rechaza
    And un valor que no corresponde al dato declarado también
    But cambiar de tipo no arrastra las características del anterior
    # Es lo que permitirá comparar lo pedido con lo que se compró; sin eso
    # vuelve la dispersión de «RAM», «Ram» y «Memoria RAM», ahora en las
    # solicitudes.
