Feature: Rendimiento con el parque completo (§21 del documento funcional)
  Como responsable de TI
  Quiero que el sistema siga siendo usable con diez mil activos
  Para que crecer el inventario no signifique dejar de usarlo

  @AC-PERF-001
  Scenario: El inventario responde rápido con filtros combinados
    Given un parque de 10.000 activos
    When se filtra por estado, criticidad, antigüedad y garantía a la vez
    Then el listado responde en decenas de milisegundos y con dos consultas
    # Es lo que el §21 pide asegurar, y es la pantalla que más se usa.

  @AC-PERF-002
  Scenario: Evaluar el parque no cuesta una consulta por activo
    Given tipos de dispositivo con y sin política de renovación
    When se evalúa la renovación en lote
    Then el número de consultas no crece con la cantidad de activos
    # El defecto original: pasar «ninguna política» era indistinguible de «no
    # me pasaron política», y el motor la volvía a buscar por cada equipo.

  @AC-PERF-003
  Scenario: Las políticas de todos los tipos se resuelven juntas
    When se resuelven las políticas de varios tipos
    Then se hacen dos consultas en total, no dos por tipo

  @AC-PERF-004
  Scenario: El prefiltro no esconde equipos que sí hay que renovar
    Given un parque con equipos que superan sus umbrales
    When se prefiltran los candidatos en la base de datos
    Then todos los que requieren renovación están entre los candidatos
    # El prefiltro puede dejar pasar de más, nunca de menos: si dejara fuera a
    # uno, el panel diría que el parque está mejor de lo que está.

  @AC-PERF-005
  Scenario: El resumen del parque se cachea
    When se consulta el centro de alertas dos veces seguidas
    Then la segunda no vuelve a recorrer el inventario
    # Son cifras agregadas que no cambian de un segundo a otro, y recorrer el
    # parque es CPU que con varios usuarios simultáneos se acumula.

  @AC-PERF-006
  Scenario: Cambiar la configuración se ve de inmediato
    Given el resumen de alertas ya cacheado
    When se apaga una alerta
    Then deja de aparecer en la siguiente consulta
    # Esperar a que expire la caché haría parecer que el cambio no se guardó.
