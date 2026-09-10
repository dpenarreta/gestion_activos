Feature: Aviso por correo de las alertas del parque (§19 del documento funcional)
  Como responsable de TI
  Quiero que el sistema me escriba cuando algo necesita atención
  Para enterarme sin tener que acordarme de entrar a mirar

  @AC-NOT-001
  Scenario: El envío llega apagado de fábrica
    Given un sistema recién instalado
    When corre la tarea de envío
    Then no se envía ningún correo y queda dicho que las notificaciones están desactivadas
    # Sin servidor de salida configurado ni destinatarios elegidos, un intento
    # de envío solo produce errores en el log.

  @AC-NOT-002
  Scenario: Envía el resumen a los destinatarios elegidos
    Given el envío activado y un destinatario válido
    And alguna alerta con equipos pendientes
    When corre la tarea de envío
    Then los destinatarios reciben el resumen del día

  @AC-NOT-003
  Scenario: Dos pasadas el mismo día no duplican el correo
    Given un resumen ya enviado hoy
    When vuelve a correr la tarea de envío
    Then no se envía un segundo correo
    # El cron puede reintentarse; recibir dos veces lo mismo le resta
    # credibilidad a los dos correos.

  @AC-NOT-004
  Scenario: La frecuencia semanal solo envía su día
    Given el envío configurado como semanal los lunes
    When corre la tarea de envío un martes
    Then no se envía nada, y sí se envía cuando corre un lunes
    # La frecuencia vive en la configuración y no en el crontab: cambiarla no
    # debería requerir un administrador de servidores.

  @AC-NOT-005
  Scenario: Un día sin nada pendiente no genera correo
    Given ninguna alerta con equipos pendientes
    When corre la tarea de envío
    Then no se envía nada y queda registrado el motivo
    # El correo que llega todos los días diciendo lo mismo deja de leerse, y
    # arrastra consigo al que sí traía algo.

  @AC-NOT-006
  Scenario: Se puede pedir el correo aunque no haya pendientes
    Given la opción de omitir los días tranquilos desactivada
    When corre la tarea de envío sin alertas pendientes
    Then llega igualmente un correo que dice que no hay nada que atender

  @AC-NOT-007
  Scenario: Deja de recibir quien pierde el permiso de ver las alertas
    Given un destinatario elegido al que se le revocó el permiso
    When corre la tarea de envío
    Then no recibe el correo
    # El filtro se aplica al enviar, no al elegir: el correo enlaza a los
    # listados del parque, y avisar a quien no puede consultarlos es filtrarle
    # información.

  @AC-NOT-008
  Scenario: Deja de recibir una cuenta dada de baja
    Given un destinatario cuya cuenta se deshabilitó
    When corre la tarea de envío
    Then no recibe el correo, sin que nadie tenga que editar la lista

  @AC-NOT-009
  Scenario: El correo no lleva datos de los equipos ni de las personas
    Given una alerta de equipos con custodio inactivo
    When se envía el resumen
    Then el correo trae el recuento y el enlace, no el equipo ni el nombre del custodio
    # Un correo sale del perímetro del sistema hacia buzones que se reenvían y
    # se archivan, donde no rigen los permisos que protegen la pantalla.

  @AC-NOT-010
  Scenario: Las direcciones viajan en copia oculta
    Given varios destinatarios configurados
    When se envía el resumen
    Then ninguno ve la dirección de los demás

  @AC-NOT-011
  Scenario: El correo tiene versión en texto plano
    When se envía el resumen
    Then el mensaje incluye el mismo contenido en texto además del HTML
    # Hay clientes corporativos que bloquean el HTML de remitentes
    # automáticos, y un correo vacío no se distingue de uno que no llegó.

  @AC-NOT-012
  Scenario: Un envío fallido queda registrado y se reintenta mañana
    Given un servidor de correo caído
    When corre la tarea de envío
    Then el fallo queda registrado y el día no se marca como enviado
    # Darlo por enviado convierte un problema de correo en un aviso que nadie
    # recibió nunca.

  @AC-NOT-013
  Scenario: Cada pasada de la tarea deja constancia
    When corre la tarea de envío
    Then queda una fila en la bitácora de envíos, se haya enviado o no
    # Un día sin ninguna fila es un cron que no corrió, y eso hay que poder
    # distinguirlo de un día tranquilo.

  @AC-NOT-014
  Scenario: El correo de prueba va solo a quien lo pide
    Given destinatarios configurados
    When alguien pide un envío de prueba
    Then el correo llega solo a su propia dirección
    # Probar que el correo sale no debería costarle un aviso falso a media
    # empresa, y un endpoint que escribe a terceros es un remitente disponible
    # para quien consiga una sesión.

  @AC-NOT-015
  Scenario: La prueba no sustituye al envío del día
    Given un envío de prueba realizado hoy
    When corre la tarea de envío
    Then el resumen del día se envía igual

  @AC-NOT-016
  Scenario: Enviar correo exige el permiso de configurar
    Given un usuario que solo puede ver las alertas
    When intenta enviar una prueba o consultar los posibles destinatarios
    Then la solicitud es rechazada
    # Mirar el estado del parque y hacer que el sistema escriba a terceros son
    # decisiones de distinto alcance.

  @AC-NOT-017
  Scenario: No se activa el envío sin destinatarios
    When se intenta activar el envío sin elegir a nadie
    Then la solicitud es rechazada
    # Encender el aviso sin nadie a quien avisar da la falsa impresión de que
    # el parque está vigilado.

  @AC-NOT-018
  Scenario: No se puede elegir como destinatario a quien no ve las alertas
    When se intenta agregar a un usuario sin permiso sobre las alertas
    Then la solicitud es rechazada indicando de quién se trata
    # Una lista que el envío descarta en silencio da la impresión de que
    # alguien está avisado cuando no lo está.

  @AC-NOT-019
  Scenario: La fecha del último envío no se edita
    When se intenta cambiar la fecha del último resumen enviado
    Then el valor no se modifica
    # Moverla saltaría el resumen de un día sin dejar rastro de quién lo hizo.

  @AC-NOT-020
  Scenario: Los posibles destinatarios llegan con el correo enmascarado
    When se consulta a quién se le puede enviar el resumen
    Then cada candidato aparece con su nombre y su dirección enmascarada
    # Quien configura necesita reconocer a la persona, no llevarse el
    # directorio de correos del personal.

  @AC-NOT-021
  Scenario: El historial muestra también lo que no se envió
    Given envíos omitidos y fallidos en la bitácora
    When se consulta el historial
    Then cada intento aparece con su resultado y su motivo
    # Un envío que falla en silencio es peor que no tener envío: hace creer
    # que alguien fue advertido.

  @AC-NOT-022
  Scenario: El envío de prueba queda auditado
    When alguien pide un envío de prueba
    Then el evento queda en el registro de auditoría con su resultado

  @AC-NOT-023
  Scenario: El sistema avisa cuando el correo no sale
    Given un servidor de correo caído
    When alguien pide un envío de prueba
    Then recibe un error que le señala revisar el servidor de salida
    # Una respuesta de éxito con el correo caído haría creer que el canal
    # funciona.

  @AC-NOT-024
  Scenario: La tarea corre a diario y la configuración decide
    Given la tarea programada todos los días
    When la frecuencia configurada dice que hoy no toca
    Then la tarea termina sin enviar, sin necesidad de tocar el cron
