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

  # --- Corregir una intervención ya registrada -----------------------------

  @AC-MNT-020
  Scenario: Corregir un dato no toca los demás
    Given una intervención registrada
    When se corrige el responsable
    Then el resto de la ficha queda como estaba
    And su desglose de repuestos también

  @AC-MNT-021
  Scenario: Guardar sin cambiar nada no escribe en la bitácora
    When se abre una intervención y se guarda sin tocar nada
    Then no se registra ningún evento de auditoría
    # El historial se lee para saber qué cambió; una fila por cada vez que
    # alguien abrió el formulario lo vuelve ilegible.

  @AC-MNT-022
  Scenario: Una intervención no cambia de equipo
    When se intenta mover una intervención a otro activo
    Then sigue perteneciendo al primero
    # Moverla falsearía los contadores de los dos equipos.

  @AC-MNT-023
  Scenario: Los repuestos enviados reemplazan el desglose entero
    Given una intervención con un repuesto registrado
    When se guarda con otros dos
    Then quedan solo esos dos
    # Si sumara, corregir una cantidad mal escrita duplicaría el repuesto y el
    # costo de la intervención crecería en cada corrección.

  @AC-MNT-024
  Scenario: Corregir los repuestos recalcula el contador de piezas críticas
    Given una intervención con una pieza crítica consumida
    When se reemplaza por una que no lo es
    Then el contador del equipo baja
    But el de intervenciones no cambia
    # Se corrigió el repuesto, no el hecho de que hubo una intervención.

  @AC-MNT-025
  Scenario: La línea nueva fotografía la criticidad vigente
    Given un componente que dejó de considerarse crítico
    When se lo registra al corregir una intervención
    Then la línea guarda que no era crítico
    But las intervenciones que no se tocaron conservan su valor anterior

  @AC-MNT-026
  Scenario: Cerrar la reparación al corregir calcula los días fuera
    Given una intervención sin fecha de salida
    When se le pone la fecha de devolución
    Then el equipo deja de estar fuera de operación
    And los días acumulados se calculan solos

  @AC-MNT-027
  Scenario: Las validaciones siguen valiendo al corregir
    When se corrige una intervención con una fecha futura, anterior a la compra
    o con salida previa al ingreso
    Then el sistema la rechaza y no guarda nada

  @AC-MNT-028
  Scenario: Registrar no alcanza para corregir
    Given un usuario que puede registrar intervenciones pero no editarlas
    When intenta corregir una
    Then el sistema le niega la acción
    # Corregir altera el contador de renovación; registrar, no.

  @AC-MNT-029
  Scenario: Eliminar deja constancia de lo que había
    When se elimina una intervención registrada por error
    Then desaparece con sus repuestos
    And la auditoría conserva quién era su responsable y de qué fecha
    And los contadores del equipo vuelven a su valor real
