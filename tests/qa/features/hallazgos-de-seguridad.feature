Feature: Hallazgos de la revisión de seguridad del 10 de septiembre de 2026
  Como responsable del sistema
  Quiero que los defectos encontrados en la revisión queden cerrados y probados
  Para que no vuelvan a abrirse sin que nadie lo note

  # --- H-01: cuentas de demostración ----------------------------------------

  @AC-SEC-001
  Scenario: La clave de las cuentas de demostración no vive en el código
    When se siembra el parque de demostración
    Then la contraseña se genera al azar o se toma del entorno
    And se imprime una sola vez, al terminar
    # Una clave fija en el código queda en el historial de Git para siempre, y
    # estas son cuentas reales: dos de ellas administran una empresa.

  @AC-SEC-002
  Scenario: Las cuentas de demostración obligan a cambiar la contraseña
    Given una cuenta creada por el comando de demostración
    When entra por primera vez
    Then el sistema le exige cambiarla antes de hacer nada más

  @AC-SEC-003
  Scenario: El despliegue se detiene si quedan cuentas de demostración
    Given una base con cuentas de demostración
    When se verifica el despliegue
    Then el resultado es crítico y dice cómo retirarlas
    # Depender de que alguien se acuerde es depender de que nadie tenga prisa.

  # --- H-03: registro público ------------------------------------------------

  @AC-SEC-004
  Scenario: Nadie se da de alta a sí mismo
    When alguien llama al endpoint de registro público
    Then no existe
    And no se crea ninguna cuenta
    # Es el inventario interno de un grupo empresarial: las cuentas las crea un
    # administrador, con su empresa y su rol.

  # --- H-02: alertas por empresa ---------------------------------------------

  @AC-SEC-005
  Scenario: El centro de alertas responde en todas las empresas
    Given dos empresas
    When se abre el centro de alertas desde cualquiera de las dos
    Then responde con su propia configuración
    # La configuración era una fila única: pertenecía a la primera empresa y la
    # segunda recibía un error de clave duplicada.

  @AC-SEC-006
  Scenario: El resumen diario sale una vez por empresa
    Given dos empresas con equipos registrados
    When corre el envío programado
    Then se envía un resumen por empresa, con los equipos de cada una
    And el asunto nombra la empresa
    # El cron corre sin empresa activa y los gestores no filtran: un solo correo
    # llevaba el parque de las dos.

  # --- H-04 y H-05: auditoría y usuarios -------------------------------------

  @AC-SEC-007
  Scenario: La auditoría no cruza empresas
    Given eventos registrados en dos empresas
    When se consulta el historial desde una
    Then no aparece ningún evento de la otra
    And lo que no pertenece a ninguna empresa sigue visible

  @AC-SEC-008
  Scenario: Un evento huérfano no se cuela por la puerta de atrás
    Given un evento de un módulo por empresa cuyo objeto ya se eliminó
    When se consulta el historial
    Then no aparece, porque no se le puede atribuir dueño

  @AC-SEC-009
  Scenario: El listado de usuarios no muestra al personal de la otra empresa
    Given cuentas en dos empresas
    When un administrador consulta el listado
    Then solo ve las de su empresa y las que no tienen ninguna
    # Las que no tienen ninguna no son de nadie, y hay que poder abrirlas para
    # asignarles una.

  @AC-SEC-010
  Scenario: Nadie concede un permiso que no tiene
    Given un usuario que administra roles pero no puede dar de baja activos
    When intenta crear un rol con ese permiso
    Then el sistema lo rechaza y dice cuál
    But el superusuario no tiene ese tope

  # --- H-06: exportaciones ---------------------------------------------------

  @AC-SEC-011
  Scenario: Un valor del inventario no se vuelve fórmula al abrir el archivo
    Given un activo cuyo nombre empieza por "="
    When se exporta el inventario, un reporte o la auditoría
    Then el valor sale marcado como texto
    # El daño no ocurre en el servidor sino en el equipo de quien abre el
    # archivo, que es justo donde el sistema ya no puede protegerlo.

  # --- H-07 y H-09: cabeceras y respaldos ------------------------------------

  @AC-SEC-012
  Scenario: Toda respuesta declara su política de contenido
    When se consulta cualquier endpoint
    Then la respuesta trae Content-Security-Policy
    And un proxy puede imponer la suya sin que esta la pise

  @AC-SEC-013
  Scenario: La ruta de respaldo se valida por forma admitida
    When se indica una ruta que no es absoluta o lleva tramos relativos
    Then el respaldo no se ejecuta
    # Una lista de lo que no puede aparecer envejece mal; una de lo que sí se
    # admite falla del lado seguro.
