Feature: Registro de auditoría (§17 del documento funcional)
  Como responsable del sistema
  Quiero leer qué se hizo, quién lo hizo y cuándo
  Para poder reconstruir lo que pasó sin depender de la memoria de nadie

  El sistema ya anotaba cada operación administrativa —eso se cubre en
  authorization.feature, incluido que el registro no se pueda alterar—, pero
  solo se podía leer consultando la API. Esto cubre poder leerlo desde el
  panel.

  @AC-AUD-001
  Scenario: El registro se lee desde el panel
    Given un usuario con el permiso de ver auditoría
    When abre Auditoría
    Then ve cada evento con su fecha y hora, quién, qué acción, sobre qué y el resultado

  @AC-AUD-002
  Scenario: Se busca por la persona, no por su número
    Given que se revisa lo que hizo una persona concreta
    When se filtra por su nombre de cuenta
    Then solo salen los eventos de esa persona
    # Por nombre y no por id: quien revisa un incidente sabe a quién busca, y
    # averiguar su número exigiría además el permiso de ver usuarios, que un
    # auditor no tiene por qué tener.

  @AC-AUD-003
  Scenario: Un evento sin autor se atribuye al sistema
    Given un evento que no disparó ninguna cuenta
    When se mira el listado
    Then la columna del usuario dice "Sistema"
    # Pasa con las tareas programadas y con los intentos sin sesión válida. En
    # blanco se leería como un dato que falta por cargar.

  @AC-AUD-004
  Scenario: El detalle enseña el antes y el después
    Given un usuario con el permiso de ver el detalle
    When abre el detalle de un evento de modificación
    Then ve los valores anteriores y los nuevos, campo por campo

  @AC-AUD-005
  Scenario: Sin permiso de detalle no se ofrece abrirlo
    Given un usuario que solo puede ver el registro
    When mira el listado
    Then no se le ofrece abrir el detalle de ningún evento
    # El servidor ya no le manda esos valores. Un botón que abriera dos
    # columnas vacías haría pensar que el evento no cambió nada.

  @AC-AUD-006
  Scenario: Sin permiso de exportar no se ofrece exportar
    Given un usuario que solo puede ver el registro
    When mira la pantalla
    Then no se le ofrece el botón de exportar

  @AC-AUD-007
  Scenario: Lo exportado es lo que se está viendo
    Given un registro filtrado por resultado o por fechas
    When se exporta
    Then el archivo trae esos mismos eventos y no el registro entero

  @AC-AUD-008
  Scenario: Un auditor sin acceso a usuarios llega igual a la pantalla
    Given un usuario cuyo único permiso es ver auditoría
    When abre el panel
    Then el menú le ofrece Auditoría
    And no le ofrece Usuarios ni Roles y permisos
    # La entrada cuelga de «Usuarios y roles», que pide ver usuarios: sin
    # permiso propio, quien audita no encontraría la pantalla por el menú.
