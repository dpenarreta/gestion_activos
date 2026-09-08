Feature: Adjuntos, evidencias y actas (§18 y §6 del documento funcional)
  Como responsable de TI
  Quiero guardar junto a cada equipo su factura, sus actas y sus evidencias
  Para poder respaldar lo que el sistema afirma cuando alguien lo pregunte

  Background:
    Given un activo registrado en el inventario

  @AC-ADJ-001
  Scenario: Se adjunta un documento a un activo
    When se sube la factura de compra del equipo
    Then queda asociada al activo, con su tipo y quién la subió

  @AC-ADJ-002
  Scenario: El archivo se guarda con un nombre generado
    When se sube un archivo cuyo nombre contiene separadores de ruta
    Then se almacena con un nombre generado por el sistema
    And el nombre original se conserva solo como dato para la descarga
    # Un nombre que viene del cliente puede traer «..», separadores o chocar
    # con otro archivo ya guardado.

  @AC-ADJ-003
  Scenario: Dos archivos con el mismo nombre no se pisan
    When se suben dos archivos llamados igual
    Then ambos se conservan por separado

  @AC-ADJ-004
  Scenario: Solo se admiten los formatos previstos
    When se intenta subir un ejecutable
    Then la carga es rechazada
    # La lista es cerrada, no de prohibidos: lo segundo obliga a acertar con
    # todo lo que podría ejecutarse en el futuro.

  @AC-ADJ-005
  Scenario: Un ejecutable renombrado a PDF también se rechaza
    When se intenta subir un ejecutable con la extensión cambiada a PDF
    Then la carga es rechazada porque el contenido no corresponde
    # La extensión la elige quien sube el archivo; la firma del contenido, no.

  @AC-ADJ-006
  Scenario: Hay un tamaño máximo
    When se intenta subir un archivo de más de 10 MB
    Then la carga es rechazada indicando el límite

  @AC-ADJ-007
  Scenario: El archivo se guarda íntegro
    When se sube un archivo
    Then lo que se descarga después es idéntico a lo que se subió
    # La validación lee los primeros bytes para comprobar la firma; si no
    # devolviera el puntero al inicio, el archivo quedaría truncado.

  @AC-ADJ-008
  Scenario: La descarga pasa por el sistema, no por una URL pública
    When se descarga un adjunto
    Then la petición exige autenticación y permiso
    And queda registrada en la bitácora
    # Aquí hay facturas y actas firmadas: una URL adivinable bastaría para
    # sacarlas todas sin pasar por el login.

  @AC-ADJ-009
  Scenario: La descarga no permite que el navegador ejecute el archivo
    When se descarga un adjunto
    Then se entrega como descarga y sin permitir adivinar el tipo
    # Un archivo subido por un usuario no debe ejecutarse en el navegador de
    # otro.

  @AC-ADJ-010
  Scenario: Un archivo que ya no está en el servidor se informa
    Given un adjunto cuyo fichero se perdió
    When se intenta descargar
    Then se informa que no está disponible, en vez de fallar con un error interno

  @AC-ADJ-011
  Scenario: Una intervención de otro equipo no se puede colgar de este activo
    When se intenta adjuntar un documento a la intervención de otro equipo
    Then la solicitud es rechazada

  @AC-ADJ-012
  Scenario: Eliminar un adjunto borra también el archivo
    When se elimina un adjunto
    Then el fichero desaparece del servidor
    And la bitácora conserva qué documento era y de qué equipo

  @AC-ADJ-013
  Scenario: Eliminar exige un permiso distinto de subir
    Given un usuario que puede subir adjuntos pero no eliminarlos
    When intenta eliminar uno
    Then la operación es rechazada
    # Un adjunto es evidencia: la factura o el acta firmada de un equipo no
    # deberían desaparecer con el mismo permiso con el que se sube una foto.

  @AC-ADJ-014
  Scenario: Dar de baja un activo no borra sus documentos
    Given un activo con su factura adjunta
    When el activo se da de baja
    Then la factura sigue disponible
    # La baja es lógica: los documentos son el respaldo de que el equipo
    # existió y de quién lo tuvo.

  @AC-ACT-001
  Scenario: La entrega de un equipo genera su acta en PDF
    Given un equipo asignado a un colaborador
    When se solicita el acta de esa asignación
    Then se obtiene un PDF con los datos del equipo, el responsable y las firmas

  @AC-ACT-002
  Scenario: La devolución genera un acta de devolución
    Given un equipo devuelto a bodega
    When se solicita el acta de esa devolución
    Then el documento es un acta de devolución, no de entrega

  @AC-ACT-003
  Scenario: El acta se construye desde el movimiento, no desde la ficha
    Given un equipo que ya cambió de custodio después de la entrega
    When se solicita el acta de la entrega original
    Then el acta refleja al custodio de aquel momento
    # El acta documenta un hecho con fecha; rehacerla desde el estado actual
    # produciría un documento con el nombre equivocado.

  @AC-ACT-004
  Scenario: Solo las entregas y devoluciones tienen acta
    When se solicita el acta de un alta en inventario
    Then la solicitud es rechazada
    # Un alta o un cambio de estado no son un traspaso de responsabilidad.

  @AC-ACT-005
  Scenario: El acta se puede revisar antes de archivarla
    When se descarga el acta sin archivarla
    Then no se guarda nada en la ficha del equipo

  @AC-ACT-006
  Scenario: El acta se archiva entre los documentos del equipo
    When se archiva el acta
    Then aparece entre los adjuntos, marcada como generada por el sistema

  @AC-ACT-007
  Scenario: Archivar dos veces no duplica el acta
    Given un acta ya archivada
    When se vuelve a archivar
    Then sigue habiendo una sola
    # Dos copias en la ficha harían dudar de cuál se firmó.
