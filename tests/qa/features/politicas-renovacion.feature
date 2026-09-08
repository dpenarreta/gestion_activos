Feature: Criterios de sustitución y sugerencia de renovación (RF-06, RF-07)
  Como administrador del sistema
  Quiero parametrizar los umbrales de obsolescencia por tipo de dispositivo
  Para que el sistema advierta cuándo conviene dejar de reparar y reemplazar un equipo

  @AC-POL-001
  Scenario: Los umbrales se configuran sin tocar el código fuente
    When se configura una política con límite de mantenimientos, de piezas críticas y de vida útil
    Then esos umbrales quedan almacenados y son editables desde el panel

  @AC-POL-002
  Scenario: Cada tipo de dispositivo puede tener sus propios límites
    Given que existe una política global
    And que existe una política específica para las laptops
    When se evalúa una laptop
    Then se aplica la política específica, no la global
    # Un servidor, una laptop y una impresora no toleran lo mismo.

  @AC-POL-003
  Scenario: Un tipo sin política propia se rige por la global
    Given que existe una política global
    When se evalúa un tipo de dispositivo sin política específica
    Then se aplica la política global

  @AC-POL-004
  Scenario: Una política desactivada no cae de vuelta en la global
    Given que existe una política global
    And que el tipo tiene una política propia desactivada
    When se evalúa un activo de ese tipo
    Then no se aplica ninguna política
    # Desactivarla significa "este tipo no se evalúa", no "usa el criterio común".

  @AC-POL-005
  Scenario: Exceder el límite de mantenimientos sugiere la renovación
    Given una política que tolera hasta dos mantenimientos
    When el activo acumula tres intervenciones
    Then el sistema muestra la alerta de sugerencia de cambio
    And el motivo indica el valor alcanzado y el umbral superado

  @AC-POL-006
  Scenario: Estar justo en el límite todavía no dispara la alerta
    Given una política que tolera hasta tres mantenimientos
    When el activo acumula exactamente tres intervenciones
    Then el sistema no sugiere renovación
    # El umbral es "máximo tolerado": se sugiere al excederlo, no al alcanzarlo.

  @AC-POL-007
  Scenario: Exceder el límite de piezas críticas sugiere la renovación
    Given una política que tolera una sola pieza crítica sustituida
    When al activo se le han reemplazado dos tarjetas madre
    Then el sistema sugiere su renovación

  @AC-POL-008
  Scenario: Cumplir la vida útil sugiere la renovación sin ninguna intervención
    Given una política con vida útil de treinta y seis meses
    When el activo alcanza cuarenta y ocho meses de antigüedad
    Then el sistema sugiere su renovación por longevidad
    # El criterio se cumple por el paso del tiempo, sin ningún evento del sistema.

  @AC-POL-009
  Scenario: Un umbral vacío desactiva ese criterio, no lo pone en cero
    Given una política que solo define el límite de mantenimientos
    When se evalúa un activo de quince años de antigüedad
    Then no se sugiere su renovación por longevidad

  @AC-POL-010
  Scenario: Los tres criterios se informan por separado
    Given una política que fija los tres umbrales
    When un activo los excede todos
    Then la alerta enumera un motivo por cada criterio superado
    # Es el respaldo cuantitativo que el área financiera necesita.

  @AC-POL-011
  Scenario: Ajustar un umbral reevalúa los activos alcanzados
    Given un activo con alerta de renovación encendida
    When se eleva el umbral de la política que lo rige
    Then la alerta del activo se apaga sin esperar a la próxima intervención

  @AC-POL-012
  Scenario: Un activo dado de baja deja de sugerir renovación
    Given un activo que excedía sus umbrales
    When el activo se da de baja
    Then ya no aparece entre las sugerencias de renovación

  @AC-POL-013
  Scenario: Una política sin ningún umbral es rechazada
    When se intenta guardar una política sin definir ningún límite
    Then la solicitud es rechazada
    # Aceptarla daría la falsa impresión de que el tipo está cubierto.

  # --- Dos niveles de aviso y ventana móvil (§11) --------------------------

  @AC-POL-014
  Scenario Outline: La antigüedad escala de «evaluar» a «reemplazo recomendado»
    Given una política que evalúa a los 48 meses y recomienda a los 60
    When el activo alcanza <antiguedad> meses
    Then el nivel de la sugerencia es <nivel>

    Examples:
      | antiguedad | nivel                 |
      | 47         | ninguno               |
      | 48         | evaluar reemplazo     |
      | 59         | evaluar reemplazo     |
      | 60         | reemplazo recomendado |
    # Con un solo nivel había que elegir entre avisar tarde o llenar la
    # pantalla de alertas que nadie puede atender todas a la vez.

  @AC-POL-015
  Scenario: La antigüedad no se informa dos veces al cruzar los dos umbrales
    Given una política con los dos niveles de vida útil
    When un activo supera ambos
    Then la alerta enumera un solo motivo de antigüedad, el del nivel más alto

  @AC-POL-016
  Scenario: Una política sin segundo nivel se comporta como antes
    Given una política que solo define la vida útil
    When un activo la supera con creces
    Then el nivel de la sugerencia es «evaluar reemplazo»
    # Las políticas configuradas antes de existir los niveles no se quedan
    # mudas ni escalan solas a una urgencia que nadie configuró.

  @AC-POL-017
  Scenario: El nivel reportado es el más severo de los criterios superados
    Given un activo que supera el conteo de reparaciones y la vida útil crítica
    When se evalúa
    Then cada motivo conserva su propio nivel
    And el veredicto del activo es el más severo de todos

  @AC-POL-018
  Scenario: El segundo nivel debe ser posterior al primero
    When se intenta guardar una política que recomienda antes de evaluar
    Then la solicitud es rechazada
    # Al revés, «recomendado» absorbería a «evaluar» y el primer aviso no
    # llegaría nunca: todo saltaría ya como urgente.

  @AC-POL-019
  Scenario: Las reparaciones se cuentan dentro de una ventana móvil
    Given una política que tolera 3 reparaciones en 12 meses
    And un activo con cuatro reparaciones, dos de ellas de hace más de dos años
    When se evalúa
    Then no se sugiere su renovación por reparaciones
    # Un contador que solo sube deja marcado para siempre un equipo que falló
    # mucho hace años y hoy funciona sin problemas.

  @AC-POL-020
  Scenario: Cuatro reparaciones dentro de la ventana sí disparan el aviso
    Given una política que tolera 3 reparaciones en 12 meses
    And un activo con cuatro reparaciones en los últimos nueve meses
    When se evalúa
    Then se sugiere evaluar su reemplazo
    And el motivo dice cuántas reparaciones fueron y en qué periodo

  @AC-POL-021
  Scenario: Sin ventana configurada se cuenta todo el historial
    Given una política que tolera 3 reparaciones sin ventana
    When un activo acumula cuatro a lo largo de su vida
    Then se sugiere evaluar su reemplazo
    # Dejar la ventana vacía significa «cuenta todo», no «cuenta los últimos
    # cero meses».

  @AC-POL-022
  Scenario: Cada tipo de dispositivo cuenta su propia ventana
    Given laptops con ventana de 6 meses e impresoras con ventana de 24
    When ambas tienen una reparación de hace un año
    Then solo la impresora la cuenta dentro de su ventana

  @AC-POL-023
  Scenario: La ventana exige un máximo de reparaciones
    When se intenta guardar una política con ventana pero sin máximo
    Then la solicitud es rechazada
    # Una ventana sin umbral no cuenta contra nada.

  @AC-POL-024
  Scenario: La ventana se resuelve en una sola consulta agregada
    When se evalúa el parque completo
    Then el conteo de reparaciones de la ventana se hace en una consulta por ventana configurada
    # El documento dimensiona entre 5.000 y 10.000 activos: una consulta por
    # equipo haría inviable el panel.

  @AC-POL-025
  Scenario: El inventario y el panel distinguen los dos niveles
    Given equipos en ambos niveles
    When se abre el panel principal
    Then se cuentan por separado los de reemplazo recomendado y los de evaluar
    And el inventario se puede filtrar por cada nivel
