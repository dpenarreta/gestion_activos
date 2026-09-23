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

  # --- Revisión del 17 de septiembre de 2026: módulo de solicitudes ---------
  #
  # El módulo nuevo mueve dos cosas sensibles: datos de personas —quién pidió
  # qué y para qué— y una bandeja de tareas ajena. Lo que sigue es lo que se
  # intentó contra él, no lo que hace cuando se usa bien.

  @AC-SEC-014
  Scenario: Ningún endpoint de solicitudes responde sin sesión
    When se piden el listado, la ficha, el catálogo o el cambio de estado sin autenticar
    Then todos responden que no hay autorización

  @AC-SEC-015
  Scenario: Lo que no es de uno no existe
    Given una solicitud de otra persona
    When alguien sin relación con ella la pide por su identificador
    Then el sistema responde que no existe, no que no puede
    And su justificación y su recorrido no aparecen por ninguna parte
    # Un «no puede» confirmaría que esa solicitud existe, y con ella que alguien
    # pidió algo.

  @AC-SEC-016
  Scenario: Gestionar no es gestionar lo de cualquiera
    When alguien con permiso de gestionar toca una solicitud que no tiene asignada
    Then el sistema lo rechaza y la solicitud no se mueve

  @AC-SEC-017
  Scenario: Los campos que decide el servidor no viajan desde el cliente
    When la petición manda el solicitante, el estado o la empresa
    Then se ignoran: el solicitante es quien está autenticado, el estado empieza
      en pendiente y la empresa es la activa
    # Es la vía natural para pedir en nombre de otro, nacer ya aprobada o
    # escribir en el ámbito de otra empresa.

  @AC-SEC-018
  Scenario: El aviso no se puede dirigir a cualquiera
    When se asigna la solicitud a una cuenta que no puede gestionarlas
    Then el sistema lo rechaza
    # El destinatario del correo sale de esa elección: sin la comprobación en el
    # servidor, el formulario serviría para mandar correo a cualquier cuenta.

  @AC-SEC-019
  Scenario: Lo de otra empresa no se ve ni se mueve desde la propia
    Given la misma cuenta trabajando en dos empresas
    When pide o intenta gestionar desde la otra
    Then no encuentra nada y nada cambia

  @AC-SEC-020
  Scenario: Las entradas hostiles no rompen ni se ejecutan
    When la búsqueda lleva comillas, comodines o una sentencia SQL
    Then la consulta responde con normalidad y no se pierde nada
    And un texto con etiquetas se guarda tal cual, para que se escape al pintarlo

  @AC-SEC-021
  Scenario: La lista de encargados no reparte correos
    When se consulta a quién se le puede asignar una solicitud
    Then se devuelve el nombre, no la dirección de correo
    # El desplegable solo necesita el nombre; el correo repartía la dirección de
    # todo el personal de compras a cualquiera que pueda ver solicitudes.

  @AC-SEC-022
  Scenario: Cada paso y cada intento quedan registrados
    When se registra una solicitud o se mueve su estado
    Then la auditoría recoge quién lo hizo
    And un intento sin permiso queda registrado como acceso denegado
    # Es lo que permite revisar después de un incidente, y notar que alguien
    # está probando puertas.
