Feature: Valor en libros y depreciación (§22.3 del documento funcional)
  Como responsable de TI o del área financiera
  Quiero saber qué vale hoy el parque y cuánto ha perdido cada equipo
  Para respaldar con cifras una solicitud de compra o una baja

  # Es depreciación **de gestión**, no contabilidad: lo que se declara ante el
  # SRI lo lleva el ERP (§20), y el §25 deja la «depreciación contable
  # avanzada» en prioridad baja. Por eso hay un solo método, línea recta.

  # --- La cuenta ---

  @AC-DEP-001
  Scenario: El costo se reparte en partes iguales entre los meses de vida contable
    Given un equipo de 1.800 con una vida contable de 36 meses
    When han pasado seis meses desde que entró en servicio
    Then su valor en libros es 1.500 y lleva 300 depreciados

  @AC-DEP-002
  Scenario: Los meses se cuentan por calendario
    Given un equipo que entró en servicio el 15 de enero
    When se consulta el 14 de febrero y luego el 15
    Then el primer día lleva cero meses y el segundo, uno
    # Tenga febrero 28 o 29 días: es la misma regla que la antigüedad del
    # equipo, y no la de 30 días que usa el formateo de duraciones.

  @AC-DEP-003
  Scenario: Un equipo pasado de vida no vale menos que cero
    Given un equipo con ocho años en servicio y una vida contable de tres
    When se consulta su valor en libros
    Then vale cero y no un número negativo

  @AC-DEP-004
  Scenario: El valor residual es el piso
    Given un equipo con un valor residual del diez por ciento
    When han pasado diez años desde que entró en servicio
    Then conserva ese diez por ciento del costo

  @AC-DEP-005
  Scenario: Se deprecia desde que entró en servicio, no desde la factura
    Given un equipo comprado en diciembre y entregado en marzo
    When se calcula su depreciación
    Then empieza a contarse desde marzo
    # Hasta entonces no estuvo produciendo nada. Es la misma distinción que ya
    # hace el sistema: la garantía corre desde la compra y la custodia desde el
    # ingreso.

  # --- Lo que no se dice con un cero ---

  @AC-DEP-006
  Scenario: Un equipo sin costo capturado no muestra un valor inventado
    Given un equipo sin costo de compra registrado
    When se consulta su depreciación
    Then se explica que falta el costo, en vez de mostrar cero
    # Un valor en libros de 0 significa «ya no vale nada», que es muy distinto
    # de «nadie capturó lo que costó».

  @AC-DEP-007
  Scenario: Sin política configurada tampoco
    Given un tipo de dispositivo sin política de depreciación ni global
    When se consulta el valor en libros de uno de sus equipos
    Then se explica que falta la política

  # --- Qué política se aplica ---

  @AC-DEP-008
  Scenario: La política del tipo gana sobre la global
    Given una política global y otra para el tipo «Servidor»
    When se deprecia un servidor
    Then se usa la del tipo

  @AC-DEP-009
  Scenario: Una política desactivada no cae de vuelta a la global
    Given una política de tipo desactivada
    When se deprecia un equipo de ese tipo
    Then no se deprecia
    # Desactivarla significa «este tipo no se deprecia aquí», que es distinto
    # de «este tipo usa el criterio común»: para eso se la elimina.

  @AC-DEP-010
  Scenario: Solo puede haber una política global
    Given una política global ya configurada
    When se intenta crear una segunda
    Then la solicitud es rechazada con un error que dice que ya existe
    # Con dos, «la global» dejaría de ser una referencia unívoca y cuál se
    # aplica dependería del orden de la tabla.

  @AC-DEP-011
  Scenario: Una vida contable de cero meses se rechaza
    When se intenta guardar una política con cero meses de vida contable
    Then la solicitud es rechazada
    # La cuota mensual sería una división por cero. Para dejar de depreciar un
    # tipo está la casilla de activa.

  # --- Dónde se ve ---

  @AC-DEP-012
  Scenario: La ficha del activo muestra el valor en libros junto al costo
    Given un equipo con costo y política de depreciación
    When se abre su ficha
    Then junto al costo aparece lo que vale hoy y qué porcentaje lleva depreciado

  @AC-DEP-013
  Scenario: Un equipo totalmente depreciado se marca sin tratarlo como un problema
    Given un equipo que terminó su vida contable
    When se abre su ficha
    Then se indica que está totalmente depreciado, sin presentarlo como una alerta
    # Depreciarse en tres años y reemplazarse a los cuatro o cinco es lo normal.

  @AC-DEP-014
  Scenario: El reporte totaliza el parque
    Given varios equipos con costo y política
    When se genera el reporte de valor en libros
    Then el pie suma el costo, la depreciación acumulada y el valor en libros

  @AC-DEP-015
  Scenario: La vida contable no es la vida útil de la política de renovación
    Given un equipo depreciado en tres años con una vida útil de cuatro
    When se consultan las dos cifras
    Then el equipo está totalmente depreciado y todavía no toca reemplazarlo
    # Confundirlas dejaría que la contabilidad decidiera cuándo se compra.
