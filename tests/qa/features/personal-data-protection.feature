Feature: Protección de datos personales
  Como responsable de cumplimiento
  Quiero que los datos personales gestionados por el sistema (nombre, correo,
  usuario, roles, permisos, accesos) solo sean accesibles a quien tiene el
  permiso correspondiente y nunca se filtren por canales no controlados
  Para respetar los principios de finalidad, minimización y acceso restringido
  de la Ley Orgánica de Protección de Datos Personales de Ecuador

  @AC-DP-001
  Scenario: Un usuario sin permisos intenta consultar datos personales
    Given que existe un usuario autenticado sin permiso para consultar usuarios
    When intenta acceder al listado de usuarios
    Then el backend rechaza la solicitud con acceso denegado
    And la respuesta no incluye ningún dato personal

  @AC-DP-002
  Scenario: Los datos personales nunca se registran en logs de acceso
    Given que un usuario inicia sesión y navega el panel administrativo
    When se revisan los logs estructurados del backend
    Then no aparece la contraseña del usuario en ningún registro
    And no aparece ningún token completo

  @AC-DP-003
  Scenario: El registro de auditoría enmascara campos sensibles antes de guardarse
    Given que ocurre un evento de auditoría cuyo payload original incluye un campo sensible
    When el evento se persiste
    Then el valor de ese campo queda reemplazado por un marcador, nunca en texto plano

  @AC-DP-004
  Scenario: Acceso a auditoría con datos personales requiere un permiso adicional al de solo listar
    Given que un usuario tiene el permiso "auditoria.ver" pero no "auditoria.ver_detalle"
    When consulta un evento de auditoría concreto
    Then ve los campos generales del evento
    But no ve los valores anteriores ni nuevos (el detalle con datos personales)

  @AC-DP-005
  Scenario: Un usuario puede consultar cuáles son sus propios permisos y datos
    Given que el usuario está autenticado
    When solicita su propio perfil
    Then recibe únicamente su información pública y sus permisos vigentes

  @AC-DP-006
  Scenario: Deshabilitar una cuenta no elimina físicamente sus datos
    Given que existe un usuario con historial de auditoría asociado
    When un administrador deshabilita la cuenta
    Then los datos y el historial se conservan (baja lógica, no eliminación física)
    And el usuario no puede volver a autenticarse mientras esté deshabilitado

  # --- Derechos sobre datos personales (apps.privacidad, 09/11/2026) ---------

  @AC-DP-007
  Scenario: Cualquier persona con cuenta pide acceso, rectificación o eliminación
    Given que una persona con sesión no tiene ningún permiso
    When pide la rectificación de un dato desde «Mi perfil»
    Then la solicitud queda pendiente con su fecha límite según el plazo legal configurado
    And quienes atienden reciben el aviso en la campana, y ella no
    And la auditoría registra el tipo de solicitud pero no su descripción

  @AC-DP-008
  Scenario: Nadie ve solicitudes ajenas sin permiso
    Given que existen solicitudes de varias personas
    When una persona sin "privacidad.ver" ni "privacidad.atender" pide la bandeja o una solicitud ajena
    Then el backend responde acceso denegado o «no encontrada»
    And la persona solo ve las suyas

  @AC-DP-009
  Scenario: Quien atiende responde y el titular se entera sin que la respuesta salga por correo
    Given que una solicitud está pendiente
    When quien tiene "privacidad.atender" la cierra con una respuesta
    Then el titular recibe un aviso en la campana y un correo que no contiene la respuesta
    And cerrar sin respuesta, repetir el estado o mover una ya movida por otra persona se rechaza

  @AC-DP-010
  Scenario: La descarga de «mis datos» trae solo lo de la persona y ningún secreto
    Given que la persona tiene datos en varios módulos y otras personas también
    When descarga sus datos en JSON o Excel
    Then el archivo incluye lo suyo de cada módulo
    And no incluye datos de otras personas, contraseñas, tokens, claves de reunión ni el rol de pagos
    And la descarga queda en la auditoría y en el registro de descargas, sin copia

  @AC-DP-011
  Scenario: Quien atiende un acceso descarga los datos del titular con las reservas de cada módulo
    Given que hay una solicitud de acceso abierta
    When quien atiende descarga los datos del titular
    Then el archivo no incluye el chat ni el Escritorio de la persona
    And los datos de salud van enmascarados salvo que ya pudiera verlos
    And solo es posible para una solicitud de acceso abierta

  @AC-DP-012
  Scenario: Las solicitudes y la descarga son de la empresa en que se piden
    Given que una persona trabaja en dos empresas del grupo
    When pide o descarga en una de ellas
    Then la solicitud y los datos son los de esa empresa
    And quien atiende en la otra empresa no la ve
