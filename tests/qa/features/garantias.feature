Feature: Situación de garantía de los activos (§4.1 del documento funcional)
  Como responsable del parque tecnológico
  Quiero saber qué equipos siguen cubiertos y cuáles están por descubrirse
  Para reclamar al proveedor antes de que venza y no pagar reparaciones cubiertas

  Background:
    Given que existe un activo registrado en el inventario

  @AC-GAR-001
  Scenario: La ficha registra proveedor y fin de garantía
    When se captura el proveedor y la fecha de fin de garantía del activo
    Then la ficha conserva ambos datos
    And el estado de garantía se deriva de la fecha, sin capturarse aparte
    # Guardar el estado exigiría un proceso diario que lo recalculara; el día
    # que fallara, el sistema diría «en garantía» sobre un equipo descubierto.

  @AC-GAR-002
  Scenario: Un equipo sin fecha capturada no se cuenta como descubierto
    Given que el activo no tiene fecha de garantía registrada
    When se consulta su situación de garantía
    Then se informa que no está registrada, y no que esté vencida
    # Un inventario a medio capturar parecería un parque entero sin cobertura.

  @AC-GAR-003
  Scenario: Una fecha ya pasada deja la garantía vencida
    Given que la garantía del activo terminó ayer
    When se consulta su situación de garantía
    Then se informa que está vencida
    And se indica hace cuántos días venció

  @AC-GAR-004
  Scenario Outline: La ventana de aviso avisa antes de perder la cobertura
    Given que la garantía del activo termina en <dias> días
    When se consulta su situación de garantía
    Then se informa que está <situacion>

    Examples:
      | dias | situacion   |
      | 0    | por vencer  |
      | 30   | por vencer  |
      | 31   | vigente     |
    # Los bordes son justo donde un error de un día haría que el aviso llegara
    # tarde para reclamarle al proveedor.

  @AC-GAR-005
  Scenario: El inventario se puede filtrar por situación de garantía
    Given equipos con garantía vencida, por vencer, vigente y sin registrar
    When se filtra el inventario por una de esas situaciones
    Then solo se listan los equipos que están en ella

  @AC-GAR-006
  Scenario: El filtro de garantía se resuelve en la base de datos
    When se filtra el inventario por situación de garantía
    Then la consulta se traduce a un rango de fechas en SQL
    # El documento dimensiona entre 5.000 y 10.000 activos: evaluar la
    # situación en Python traería el inventario completo a memoria.

  @AC-GAR-007
  Scenario: Un valor de filtro desconocido no vacía el inventario
    When se filtra por una situación de garantía que no existe
    Then el listado devuelve el inventario sin filtrar
    # Un parámetro mal escrito en un enlace no debe hacer creer que no hay nada.

  @AC-GAR-008
  Scenario: El panel principal separa lo vencido de lo no capturado
    Given equipos con garantía vencida, por vencer y sin registrar
    When se abre el panel principal
    Then los vencidos y los próximos a vencer se cuentan por separado
    And los que no tienen fecha capturada se señalan como dato pendiente
