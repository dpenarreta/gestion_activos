Feature: Separación de la información por empresa
  Como responsable de TI del grupo
  Quiero que cada empresa vea solo su propia información
  Para administrar varias empresas desde un mismo sistema sin mezclarlas

  # --- El aislamiento ------------------------------------------------------

  @AC-EMP-001
  Scenario: Una empresa no ve el inventario de otra
    Given dos empresas con activos registrados
    When un usuario de la primera consulta el inventario
    Then solo ve los activos de su empresa
    # El filtro vive en el gestor por defecto de cada modelo, no en cada
    # consulta: son más de veinte vistas y basta con que una lo olvide.

  @AC-EMP-002
  Scenario: Los catálogos también están separados
    Given dos empresas con sedes, departamentos, empleados y proveedores
    When un usuario de la primera abre cualquiera de esos catálogos
    Then solo ve los registros de su empresa

  @AC-EMP-003
  Scenario: Lo que se registra nace en la empresa activa
    Given un usuario trabajando en una empresa
    When registra un activo
    Then el activo queda en esa empresa sin que nadie tenga que indicarlo
    # Las altas llegan por muchos caminos —formulario, carga masiva, actas— y
    # la que olvide la empresa crearía un registro invisible para todos.

  @AC-EMP-004
  Scenario: Pedir una empresa ajena no muestra nada
    Given un usuario que no pertenece a una empresa
    When pide expresamente los datos de esa empresa
    Then no obtiene información alguna
    # Devolver la empresa predeterminada le haría creer que está viendo lo que
    # pidió; el error es más seguro que la sustitución silenciosa.

  @AC-EMP-005
  Scenario: Los identificadores únicos lo son dentro de cada empresa
    Given dos empresas
    When cada una registra un departamento llamado "TI"
    Then ambas conservan el suyo sin conflicto
    # Dos empresas del grupo numeran sus equipos por su cuenta, y una serie de
    # fábrica puede repetirse entre inventarios que nunca se cruzan.

  # --- Quién administra las empresas ---------------------------------------

  @AC-EMP-006
  Scenario: Ver las empresas exige un permiso del catálogo
    Given un usuario sin el permiso "empresas.ver"
    When consulta el listado de empresas
    Then el sistema le niega el acceso

  @AC-EMP-007
  Scenario: Ver no alcanza para crear
    Given un usuario con el permiso "empresas.ver" pero sin "empresas.editar"
    When intenta crear una empresa
    Then el sistema le niega la acción

  @AC-EMP-008
  Scenario: El alta de una empresa queda auditada
    Given un usuario con el permiso "empresas.editar"
    When crea una empresa
    Then queda registrado en la auditoría quién la creó y con qué datos

  @AC-EMP-009
  Scenario: Una empresa no se elimina, se desactiva
    Given una empresa con información registrada
    When se intenta eliminarla
    Then el sistema no lo permite
    And desactivarla la saca del selector sin borrar su historial
    # Es la dueña de todo lo registrado: borrarla dejaría el inventario
    # huérfano.

  # --- Quién reparte el acceso ---------------------------------------------

  @AC-EMP-010
  Scenario: Asignar empresas no es administrar usuarios
    Given un usuario que puede crear y editar usuarios pero no tiene "empresas.asignar"
    When intenta asignar empresas a otra cuenta
    Then el sistema le niega la acción
    # Editar un perfil es mantenimiento; asignar una empresa es dar acceso a
    # todo su inventario.

  @AC-EMP-011
  Scenario: La asignación reemplaza la lista completa
    Given un usuario asignado a una empresa
    When se le asigna otra distinta
    Then queda con esa única empresa
    # Quien revisa accesos piensa en "esta persona ve estas", no en sumar y
    # restar sobre un estado anterior que ya no recuerda.

  @AC-EMP-012
  Scenario: Solo una empresa puede ser la predeterminada
    When se marcan dos empresas como predeterminadas
    Then el sistema rechaza la operación y no asigna nada
    # Es la que se abre al entrar: con dos marcadas no hay cuál elegir.

  @AC-EMP-013
  Scenario: Nadie puede dejarse a sí mismo sin empresas
    Given un administrador con una sola empresa asignada
    When intenta quitarse todas sus empresas
    Then el sistema rechaza la operación
    # Dejaría de ver todo y no podría devolverse el acceso por sí mismo.

  @AC-EMP-014
  Scenario: El reparto de accesos queda auditado
    When se cambian las empresas de un usuario
    Then queda registrado quién lo hizo, qué empresas tenía antes y cuáles tiene ahora

  # --- El selector del menú ------------------------------------------------

  @AC-EMP-015
  Scenario: Saber en qué empresa se está no exige permisos
    Given un usuario sin ningún permiso de administración de empresas
    When entra al sistema
    Then ve en el menú en qué empresa está trabajando
    # Es orientación, no administración: quien solo consulta el inventario de
    # su empresa también necesita saber cuál es.

  @AC-EMP-016
  Scenario: Con una sola empresa el selector no estorba
    Given un despliegue con una única empresa
    When un usuario entra al sistema
    Then ve el nombre de la empresa pero no un desplegable
    # Un selector de un solo elemento no elige nada, solo ocupa sitio.

  @AC-EMP-017
  Scenario: Mientras hay una sola empresa la membresía no es obligatoria
    Given un despliegue con una única empresa
    When se crea una cuenta sin asignarle membresía
    Then trabaja en esa empresa
    But en cuanto se crea la segunda empresa la membresía pasa a ser obligatoria
    # En un despliegue de una empresa no hay de quién aislarse; exigir el
    # trámite dejaría cada cuenta nueva sin ver nada hasta un segundo paso.

  # --- Qué puede hacer cada uno en cada empresa ----------------------------

  @AC-EMP-018
  Scenario: Un rol vale solo en la empresa donde se dio
    Given un usuario asignado a dos empresas
    And con un rol que administra el inventario solo en la primera
    When intenta administrar el inventario de la segunda
    Then el sistema le niega la acción
    # Con roles en el usuario, darle acceso a la segunda empresa le entregaría
    # de paso todos los permisos que tenía en la primera.

  @AC-EMP-019
  Scenario: Cada empresa puede tener su propio rol
    Given un usuario que administra el inventario de una empresa
    And solo consulta el de otra
    When trabaja en cada una
    Then puede registrar activos en la primera y solo verlos en la segunda

  @AC-EMP-020
  Scenario: Los roles globales valen en todas las empresas
    Given un usuario con un rol asignado fuera de toda empresa
    When trabaja en cualquiera de las suyas
    Then ese rol se le aplica
    # El administrador del grupo tiene que poder entrar a cualquiera, incluidas
    # las que se creen mañana.

  @AC-EMP-021
  Scenario: Quitar la empresa se lleva sus roles
    Given un usuario con un rol en una empresa
    When se le quita esa empresa
    Then deja de tener ese rol allí
    # Un rol huérfano volvería a valer en cuanto alguien le devolviera el
    # acceso, sin que nadie lo hubiera decidido.

  @AC-EMP-022
  Scenario: Una empresa asignada sin rol no da acceso a nada
    Given un usuario asignado a una empresa sin ningún rol en ella
    When entra a esa empresa
    Then la ve en el selector pero no puede abrir su información
    And la pantalla de asignación lo advierte antes de guardar

  @AC-EMP-023
  Scenario: El historial dice qué rol se quitó y en qué empresa
    When se cambian los roles de un usuario en una empresa
    Then la auditoría registra los nombres del rol y de la empresa
    # Dentro de un año, "desapareció el rol 4 de la empresa 3" no le dice nada
    # a quien revisa.

  @AC-EMP-024
  Scenario: El alta pregunta con qué empresa y qué rol entra la cuenta
    Given un administrador que puede crear usuarios y asignar empresas
    When da de alta una cuenta
    Then elige su empresa y su rol en el mismo formulario
    And la cuenta queda usable desde el primer inicio de sesión
    # Dejarlo para un segundo paso garantiza que alguna se quede a medias el
    # día que a quien la crea lo interrumpan entre uno y otro.

  @AC-EMP-025
  Scenario: Crear usuarios no alcanza para darles empresa
    Given un administrador que puede crear usuarios pero no asignar empresas
    When intenta dar de alta una cuenta indicando su empresa
    Then el sistema le niega la operación y no crea la cuenta
    # Dar de alta a alguien y decidir qué información va a ver son dos poderes
    # distintos.

  @AC-EMP-026
  Scenario: Lo que cuelga de un activo tampoco cruza empresas
    Given dos empresas con equipos y mantenimientos registrados
    When se consulta la bitácora desde una de ellas
    Then no aparece ninguna intervención de la otra
    # El mantenimiento no lleva la empresa encima: la hereda del activo que
    # reparó, y sin filtrar por esa ruta la bitácora de una se leería desde la
    # otra. Lo mismo vale para movimientos, repuestos consumidos y adjuntos.
