Feature: Administración de roles
  Como administrador del sistema
  Quiero crear roles y asignarles permisos del catálogo
  Para organizar el acceso de los usuarios por función

  Background:
    Given que existe un administrador con permisos completos de roles

  @AC-030
  Scenario: Crear un rol con una selección parcial de permisos
    When el administrador crea un rol con un subconjunto de permisos del catálogo
    Then el rol queda creado con exactamente esos permisos
    And se registra un evento de auditoría "role.created"

  @AC-030
  Scenario: Un rol puede contener todos los permisos de un módulo
    When el administrador crea un rol seleccionando todos los permisos del módulo "usuarios"
    Then el rol queda creado con esos permisos completos

  @AC-030
  Scenario: No se pueden crear dos roles con el mismo nombre
    Given que ya existe un rol llamado "Soporte"
    When el administrador intenta crear otro rol con el mismo nombre
    Then el sistema rechaza la creación

  @AC-031
  Scenario: Editar el nombre y los permisos de un rol
    Given que existe un rol con un permiso asignado
    When el administrador cambia su nombre y le agrega otro permiso
    Then el rol refleja ambos cambios
    And se registra un evento de auditoría "role.updated" únicamente con los campos que cambiaron

  @AC-032
  Scenario: Asignar un rol a un usuario
    Given que existen un usuario y un rol
    When el administrador asigna ese rol al usuario
    Then el usuario queda asociado al rol
    And hereda los permisos del rol

  @AC-033
  Scenario: Retirar un rol de un usuario
    Given que un usuario tiene un rol asignado
    When el administrador retira ese rol
    Then el usuario deja de tener los permisos que ese rol otorgaba

  @AC-034
  Scenario: Asignar permisos individuales a un usuario
    Given que existe un usuario sin permisos directos
    When el administrador le asigna permisos individuales del catálogo
    Then el usuario cuenta con esos permisos además de los heredados por rol

  @AC-035
  Scenario: Retirar permisos individuales de un usuario
    Given que un usuario tiene permisos individuales asignados
    When el administrador se los retira
    Then el usuario deja de contar con esos permisos

  @AC-ROL-001
  Scenario: Eliminación física de un rol
    Given que existe un rol sin usuarios asignados
    When el administrador lo elimina
    Then el rol deja de existir
    And se registra un evento de auditoría "role.deleted"

  @AC-ROL-002
  Scenario: Acceso al catálogo de permisos para construir el formulario de rol
    Given que el administrador abre el formulario de un nuevo rol
    When el frontend solicita el catálogo de permisos
    Then recibe todos los módulos con sus permisos y descripciones

  @AC-ROL-003
  Scenario: Un usuario sin permiso de roles no puede administrar roles
    Given que existe un usuario sin el permiso "roles.ver"
    When intenta listar los roles
    Then el backend rechaza la solicitud con 403
    And el intento queda auditado
