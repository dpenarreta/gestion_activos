Feature: Bitácora de mantenimientos y contador de intervenciones (RF-04, RF-05)
  Como administrador del parque tecnológico
  Quiero registrar cada intervención con su desglose de repuestos
  Para saber qué fallas ha tenido cada equipo y cuánto se ha invertido en sostenerlo

  Background:
    Given que existe un activo registrado en el inventario

  @AC-MNT-001
  Scenario: Registrar una intervención con todos sus datos
    When se registra un mantenimiento con fecha, responsable, descripción, diagnóstico y componentes
    Then el mantenimiento queda almacenado con su desglose completo
    And el costo total suma la mano de obra y los repuestos

  @AC-MNT-002
  Scenario: El contador de intervenciones se incrementa automáticamente
    When se registran tres mantenimientos sobre el activo
    Then el contador acumulado del activo indica tres intervenciones
    And no hace falta contar manualmente los registros del historial

  @AC-MNT-003
  Scenario: Solo las piezas marcadas como críticas alimentan el conteo de críticas
    When se registra un mantenimiento con dos discos duros y cinco teclados
    Then el conteo de piezas críticas sustituidas es dos
    # Los teclados no están marcados como críticos en el catálogo.

  @AC-MNT-004
  Scenario: Corregir el historial deja los contadores consistentes
    Given que el activo tiene dos mantenimientos registrados
    When se elimina uno de ellos por haber sido capturado por error
    Then el contador vuelve a indicar un solo mantenimiento
    And el conteo de piezas críticas se ajusta en consecuencia

  @AC-MNT-005
  Scenario: Cambiar la criticidad del catálogo no reescribe el historial
    Given que se registró el consumo de una pieza no marcada como crítica
    When esa pieza pasa a considerarse crítica en el catálogo
    Then las intervenciones ya registradas conservan la regla vigente cuando ocurrieron

  @AC-MNT-006
  Scenario: No se registran intervenciones futuras
    When se intenta registrar un mantenimiento con fecha futura
    Then la solicitud es rechazada

  @AC-MNT-007
  Scenario: No se registran intervenciones anteriores a la compra del equipo
    When se intenta registrar un mantenimiento anterior a la fecha de adquisición
    Then la solicitud es rechazada

  @AC-MNT-008
  Scenario: No se registran mantenimientos sobre un activo dado de baja
    Given que el activo fue dado de baja
    When se intenta registrar una intervención sobre él
    Then la solicitud es rechazada

  @AC-MNT-009
  Scenario: El sistema informa cuánto se ha invertido en sostener un equipo
    Given que el activo tiene mantenimientos con costos de mano de obra y repuestos
    When se consulta el resumen de costos del activo
    Then se obtiene el desglose de mano de obra, repuestos y total acumulado

  @AC-MNT-010
  Scenario: Una reparación sin cerrar no reporta días fuera de operación
    Given que el equipo ingresó a reparación y aún no se ha devuelto
    When se consulta el tiempo que estuvo fuera de operación
    Then el sistema informa que sigue fuera, sin dar un número de días
    # Un cero se sumaría como si la reparación no hubiera costado tiempo.

  @AC-MNT-011
  Scenario: Al cerrar la reparación se calculan los días fuera de operación
    Given que el equipo ingresó a reparación
    When se registra su fecha de salida tres días después
    Then el sistema informa tres días fuera de operación
    And el equipo deja de contarse entre los que siguen en reparación

  @AC-MNT-012
  Scenario: La salida no puede ser anterior al ingreso
    When se intenta cerrar una reparación con fecha de salida previa al ingreso
    Then la solicitud es rechazada

  @AC-MNT-013
  Scenario: La bitácora registra causa, solución y desenlace
    When se registra una intervención con causa, solución y estado final
    Then los tres datos quedan almacenados junto al trabajo realizado
    And se puede indicar si la intervención se cubrió con la garantía del proveedor

  @AC-MNT-014
  Scenario: El panel acumula el tiempo fuera de operación del parque
    Given intervenciones cerradas y otras aún abiertas
    When se abre el panel principal
    Then se informan los días acumulados solo de las cerradas
    And se indica cuántos equipos siguen en reparación
