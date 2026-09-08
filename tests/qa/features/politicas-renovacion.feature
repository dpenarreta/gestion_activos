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
