Feature: Mis equipos y el rol «Usuario final» (§13 del documento funcional)
  Como persona que usa un equipo de la empresa
  Quiero ver qué tengo a mi cargo y desde cuándo
  Para saber de qué respondo y poder identificarlo al pedir soporte

  # El documento le concede una sola cosa —«opcionalmente consulta equipos
  # asignados a sí mismo»— y toda la dificultad está en el «a sí mismo».

  # --- Lo que el rol puede y lo que no ---

  @AC-MIS-001
  Scenario: Ver lo propio no es ver el inventario
    Given una cuenta con el rol «Usuario final»
    When consulta sus equipos
    Then ve únicamente los que tiene a su cargo
    # `activos.ver_asignados` es un permiso distinto de `activos.ver`, y en eso
    # consiste el rol: con el segundo vería el parque entero, los custodios de
    # todos y los costos.

  @AC-MIS-002
  Scenario: El rol no abre el inventario
    Given una cuenta con el rol «Usuario final»
    When intenta abrir el listado de activos
    Then la solicitud es rechazada

  @AC-MIS-003
  Scenario: Sin el permiso no se ve ni lo propio
    Given una cuenta sin ningún permiso sobre activos
    When consulta sus equipos
    Then la solicitud es rechazada

  # --- Qué muestra la pantalla y qué calla ---

  @AC-MIS-004
  Scenario: No se exponen costo, proveedor ni el veredicto de renovación
    Given una cuenta con un equipo a su cargo
    When consulta sus equipos
    Then no aparecen el costo, el proveedor ni la sugerencia de reemplazo
    # Son datos del inventario, no del aparato que uno usa. El veredicto además
    # es una decisión de planificación —«este equipo se reemplaza el año que
    # viene»— que no se comunica por una pantalla.

  @AC-MIS-005
  Scenario: Dice desde cuándo lo tiene esta persona
    Given un equipo que fue entregado, devuelto y entregado otra vez a la misma persona
    When consulta sus equipos
    Then la fecha que se muestra es la de la última entrega a esa persona
    # Sale del historial y no de la ficha: un equipo que fue y volvió tiene
    # varias entregas.

  @AC-MIS-006
  Scenario: Un equipo dado de baja deja de aparecer
    Given un equipo a cargo de una persona
    When se da de baja
    Then deja de figurar entre sus equipos
    # Sigue en el historial, pero ya no lo tiene nadie: mostrarlo haría creer
    # que hay que devolverlo.

  # --- Las tres razones distintas de no ver nada ---

  @AC-MIS-007
  Scenario: Sin equipos a cargo no se advierte nada
    Given una cuenta enlazada a una ficha de empleado sin equipos
    When consulta sus equipos
    Then ve una lista vacía y ninguna advertencia

  @AC-MIS-008
  Scenario: Una cuenta sin ficha de empleado lo dice
    Given una cuenta que no está enlazada a ninguna ficha de empleado
    When consulta sus equipos
    Then se le explica que su cuenta no está enlazada y que lo resuelve un administrador
    # «No tienes equipos» y «tu cuenta no está enlazada» se arreglan de formas
    # muy distintas, y la segunda necesita a un administrador.

  @AC-MIS-009
  Scenario: Con la ficha en otra empresa, se dice en cuál
    Given una cuenta cuya ficha de empleado pertenece a otra empresa del grupo
    When consulta sus equipos desde la empresa en la que no tiene ficha
    Then se le dice en qué empresa está su ficha
    # Cambiar de empresa no borra los equipos de nadie: una lista vacía se
    # leería como «ya no tienes nada», y lo que hay que hacer es cambiar de
    # empresa en el menú.

  # --- Por dónde entra al sistema ---

  @AC-MIS-011
  Scenario: La pantalla no ocupa sitio en el menú de quien administra
    Given una cuenta que administra el inventario
    When mira el menú lateral
    Then no aparece «Mis equipos»
    # Es una vista personal, no una de operación: en la barra de quien
    # administra el parque solo estorbaba. La pantalla sigue ahí, y el usuario
    # final entra directamente a ella.

  @AC-MIS-010
  Scenario: Entrar al panel lleva a la primera pantalla que se puede abrir
    Given una cuenta con el rol «Usuario final»
    When entra al panel administrativo
    Then llega a «Mis equipos» y no a una pantalla que no puede ver
    # El panel principal exige `activos.ver`: sin esto, el usuario final
    # entraba al sistema y chocaba con un 403 teniendo su pantalla a un clic.
