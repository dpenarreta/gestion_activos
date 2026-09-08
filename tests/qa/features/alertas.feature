Feature: Centro de alertas del parque (§19 del documento funcional)
  Como responsable de TI
  Quiero que el sistema me diga qué necesita atención hoy
  Para no descubrir los problemas cuando ya no tienen remedio

  @AC-ALE-001
  Scenario: Las alertas se calculan al consultarlas, no se almacenan
    When se abre el centro de alertas
    Then cada alerta refleja la situación del inventario en ese momento
    # Una alerta persistida hay que retirarla cuando la situación se resuelve,
    # y la que nadie retira envejece hasta que se deja de mirar la pantalla.

  @AC-ALE-002
  Scenario: El centro responde aunque nadie lo haya configurado
    Given un sistema recién instalado
    When se abre el centro de alertas
    Then funciona con los umbrales por defecto

  @AC-ALE-003
  Scenario: Los umbrales son una decisión de la empresa, no de cada usuario
    When dos personas consultan las alertas
    Then ambas ven los mismos umbrales aplicados
    # Con umbrales por usuario, dos personas mirando el mismo parque verían
    # realidades distintas y no podrían acordar qué atender.

  @AC-ALE-004
  Scenario: Avisa de las garantías próximas a vencer
    Given un equipo cuya garantía vence dentro de la ventana de aviso
    When se consultan las alertas
    Then aparece entre las garantías próximas a vencer

  @AC-ALE-005
  Scenario: Una garantía ya vencida no es un aviso con plazo
    Given un equipo cuya garantía venció ayer
    When se consultan las alertas
    Then no aparece entre las garantías próximas a vencer
    # Pasada la fecha ya no hay nada que reclamarle al proveedor.

  @AC-ALE-006
  Scenario: Avisa de las reparaciones que llevan demasiado sin cerrar
    Given una intervención abierta desde hace más días que el umbral
    When se consultan las alertas
    Then aparece entre las reparaciones sin cerrar, con los días que lleva
    # O la reparación se atascó o alguien olvidó cerrarla; ninguna de las dos
    # se ve en la bitácora ordenada por fecha.

  @AC-ALE-007
  Scenario: Avisa de los equipos cuyo responsable ya no está activo
    Given un equipo asignado a un empleado que fue dado de baja
    When se consultan las alertas
    Then aparece con severidad alta
    # Un equipo sin responsable real: si se pierde, nadie responde por él.

  @AC-ALE-008
  Scenario: Avisa de los activos parados en bodega
    Given un equipo que lleva más días en bodega que el umbral
    When se consultan las alertas
    Then aparece entre los activos sin asignar, con severidad informativa
    # Es capital inmovilizado, no una urgencia.

  @AC-ALE-009
  Scenario: Avisa de las fichas que nadie ha tocado en mucho tiempo
    Given un equipo sin cambios desde hace más días que el umbral
    When se consultan las alertas
    Then aparece entre las fichas sin actualizar
    # No dice que el dato esté mal: dice que nadie lo ha confirmado.

  @AC-ALE-010
  Scenario: Avisa de los equipos próximos a reemplazo, separando los niveles
    Given equipos con reemplazo recomendado y otros a evaluar
    When se consultan las alertas
    Then la alerta indica cuántos hay de cada nivel
    And su severidad es alta solo si alguno tiene el reemplazo recomendado

  @AC-ALE-011
  Scenario: Avisa aparte de los equipos que se reparan demasiado
    Given un equipo que excede el número de intervenciones de su política
    When se consultan las alertas
    Then aparece en su propia alerta, separada de la de reemplazo
    # Un equipo viejo se reemplaza; uno que falla mucho puede tener un
    # problema concreto que conviene diagnosticar antes de gastar en otro.

  @AC-ALE-012
  Scenario: Un activo dado de baja no genera alertas
    Given un equipo dado de baja que cumpliría varias condiciones de alerta
    When se consultan las alertas
    Then no aparece en ninguna
    # Ya salió del parque: nadie puede ni debe resolver nada sobre él.

  @AC-ALE-013
  Scenario: Los umbrales son configurables
    When se cambia el umbral de días de una alerta
    Then el conteo se recalcula con el nuevo valor

  @AC-ALE-014
  Scenario: Un umbral en cero es rechazado
    When se intenta guardar un umbral de cero días
    Then la solicitud es rechazada
    # Avisaría de todo el parque desde el primer día, que es indistinguible
    # de no tener la alerta.

  @AC-ALE-015
  Scenario: Cada alerta se puede apagar
    Given una alerta que no interesa a la organización
    When se desactiva
    Then deja de calcularse y no aparece en la pantalla
    # Una alerta que no se puede apagar acaba siendo ruido que se ignora en
    # bloque, y con ella el resto.

  @AC-ALE-016
  Scenario: Una alerta sin pendientes se reporta igual
    Given una alerta activa cuyo conteo es cero
    When se consultan las alertas
    Then se informa que no tiene pendientes
    # «Revisado, nada pendiente» es información, y es distinto de una alerta
    # apagada, que sencillamente no aparece.

  @AC-ALE-017
  Scenario: Las alertas se ordenan por gravedad
    Given alertas de distinta severidad con pendientes
    When se consultan
    Then las de severidad alta encabezan la lista

  @AC-ALE-018
  Scenario: El resumen trae una muestra, no el listado completo
    When se consultan las alertas
    Then cada una trae su total y unos pocos equipos de ejemplo
    And enlaza al listado ya filtrado donde se puede trabajar con todos
    # Devolver 800 activos dentro del resumen haría lenta justo la pantalla
    # que debería abrir más rápido.

  @AC-ALE-019
  Scenario: La muestra no repite el mismo equipo
    Given equipos en los dos niveles de reemplazo
    When se mira la muestra de esa alerta
    Then ningún equipo aparece dos veces
    # Verlo repetido haría dudar de si son dos equipos distintos.

  @AC-ALE-020
  Scenario: Dos reparaciones abiertas del mismo equipo son dos filas
    Given un equipo con dos intervenciones sin cerrar
    When se mira la muestra de reparaciones sin cerrar
    Then aparecen las dos, identificadas por separado

  @AC-ALE-021
  Scenario: Los enlaces de cada alerta llevan al listado filtrado
    When se pulsa el enlace de una alerta
    Then se abre el listado con el filtro que corresponde a esa situación

  @AC-ALE-022
  Scenario: Ver las alertas exige permiso
    Given un usuario sin el permiso de alertas
    When intenta abrir el centro de alertas
    Then la operación es rechazada

  @AC-ALE-023
  Scenario: Configurar exige un permiso distinto de ver
    Given un usuario que puede ver las alertas pero no configurarlas
    When intenta cambiar un umbral
    Then la operación es rechazada
    # Ver el estado del parque y decidir cuándo el sistema debe avisar son
    # decisiones de distinto alcance.

  @AC-ALE-024
  Scenario: Cambiar la configuración queda auditado
    When se modifica un umbral
    Then la bitácora registra quién lo cambió, el valor anterior y el nuevo
