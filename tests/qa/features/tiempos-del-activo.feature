Feature: Cálculo de tiempos del activo (§10 del documento funcional)
  Como responsable de TI
  Quiero saber cuánto lleva cada equipo en cada situación
  Para decidir con datos y no con impresiones

  @AC-TIE-001
  Scenario: El sistema calcula los siete tiempos del documento
    When se consulta la ficha de un activo
    Then informa el tiempo desde la compra, desde el ingreso, desde la primera asignación, con el custodio actual, acumulado en reparación, guardado sin uso y activo real

  @AC-TIE-002
  Scenario: El tiempo desde la compra y desde el ingreso se cuentan por separado
    Given un equipo comprado en diciembre que entró al inventario en marzo
    When se consultan sus tiempos
    Then los dos números son distintos
    # No estuvo en la empresa esos tres meses.

  @AC-TIE-003
  Scenario: Sin fecha de ingreso, el cálculo se mide desde la compra y lo declara
    Given un equipo sin fecha de ingreso registrada
    When se consulta su tiempo activo real
    Then se indica que está medido desde la compra
    # Dos tiempos medidos desde bases distintas no son comparables entre
    # equipos, así que la base se declara.

  @AC-TIE-004
  Scenario: El tiempo con el custodio actual no incluye los períodos ajenos
    Given un equipo devuelto y reentregado a la misma persona
    When se consulta cuánto lleva con su custodio
    Then se cuenta desde la reentrega, no desde la primera vez
    # Quien mira la ficha para saber desde cuándo lo custodia leería una fecha
    # en la que el equipo estaba en otra mesa.

  @AC-TIE-005
  Scenario: Un equipo sin custodio no tiene tiempo con el custodio actual
    When se consulta la ficha de un equipo en bodega
    Then el tiempo con el custodio actual aparece vacío, no en cero
    # «Cero días» diría que se lo acaban de entregar.

  @AC-TIE-006
  Scenario: La reparación abierta se informa aparte de la acumulada
    Given un equipo con una reparación cerrada y otra en curso
    When se consultan sus tiempos
    Then el acumulado y el tramo abierto se muestran por separado
    # Sumarlos escondería que el equipo sigue fuera de operación ahora mismo.

  @AC-TIE-007
  Scenario: El tiempo sin uso suma lo que el equipo estuvo guardado
    Given un equipo que estuvo en bodega antes de entregarse
    When se consultan sus tiempos
    Then el tiempo sin uso corresponde a ese período

  @AC-TIE-008
  Scenario: Un equipo que salió del inventario deja de acumular tiempo
    Given un equipo robado hace seis meses
    When se consultan sus tiempos
    Then esos seis meses no cuentan como tiempo sin uso
    # No está: seguir sumándole tiempo lo haría aparecer como el equipo más
    # ocioso del parque.

  @AC-TIE-009
  Scenario: El tiempo activo real descuenta lo guardado y lo reparado
    When se consulta el tiempo activo real de un equipo
    Then equivale a su tiempo en la empresa menos lo que pasó en bodega y en el taller

  @AC-TIE-010
  Scenario: El tiempo activo real nunca es negativo
    Given fechas mal capturadas que hacen que los descuentos superen el total
    When se consultan sus tiempos
    Then el tiempo activo real es cero
    # Un número negativo en la ficha solo confunde a quien lo lee.

  @AC-TIE-011
  Scenario: Calcular los tiempos no multiplica las consultas
    When se abre la ficha de un activo
    Then el historial y la bitácora se precargan en una sola consulta cada uno
    # Los tiempos se reconstruyen del historial; sin precargarlo, cada uno se
    # llevaría su propia consulta.
