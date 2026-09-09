Feature: Ficha completa del activo (§4.1, §12 y §14 del documento funcional)
  Como responsable de TI
  Quiero que la ficha diga dónde está el equipo, qué tan crítico es y en qué situación se encuentra
  Para que el inventario responda las preguntas que se hacen en el día a día

  # --- Los nueve estados (§12) ---

  @AC-EST-001
  Scenario: El activo tiene los nueve estados del documento
    When se consulta la lista de estados posibles
    Then están disponible, asignado, en reparación, en garantía, en bodega, en tránsito, dado de baja, perdido y robado

  @AC-EST-002
  Scenario: Disponible y en bodega son estados distintos
    Given un equipo recién devuelto y otro ya revisado
    When se listan los equipos almacenados
    Then aparecen los dos, pero solo el revisado figura como disponible
    # Los dos están guardados, pero solo uno se puede entregar hoy: marcar
    # entregable lo recién devuelto haría prometer equipos sin revisar.

  @AC-EST-003
  Scenario: Sacar un equipo del inventario exige decir por qué
    When se registra un equipo como perdido o robado sin motivo
    Then la solicitud es rechazada
    # Un equipo desaparecido sin explicación no deja ninguna constancia de qué
    # pasó, que es lo que habría que consultar meses después —y en el caso del
    # robo, lo que respalda la denuncia.

  @AC-EST-004
  Scenario: Un equipo que sale del inventario deja de estar a nombre de nadie
    Given un equipo asignado a un custodio
    When se registra como robado
    Then queda sin custodio, con la fecha y el motivo de la salida
    And el historial conserva quién lo tenía

  @AC-EST-005
  Scenario: Un equipo perdido que aparece vuelve al inventario
    Given un equipo registrado como perdido
    When se lo reingresa a bodega
    Then vuelve a ser parte del parque y se limpian la fecha y el motivo de salida
    # Ya no describen su situación; el historial conserva que estuvo fuera.

  @AC-EST-006
  Scenario: Un equipo dado de baja no vuelve
    Given un equipo dado de baja
    When se intenta cambiarle el estado
    Then la solicitud es rechazada
    # La baja es una desincorporación: su expediente queda como respaldo, y
    # revivirlo dejaría el historial contando otra cosa.

  @AC-EST-007
  Scenario: No se asigna un equipo que ya no está
    Given un equipo perdido, robado o dado de baja
    When se intenta asignarlo a un custodio
    Then la solicitud es rechazada
    # Antes se colaba: el estado no cambiaba, pero el custodio sí, y quedaba un
    # responsable nuevo para un equipo que ya no existe.

  @AC-EST-008
  Scenario: En tránsito y en reclamación de garantía siguen siendo parque
    Given un equipo en tránsito entre sedes
    When se consulta el inventario operativo
    Then aparece, porque describe dónde está y no que haya salido

  @AC-EST-009
  Scenario: Lo que salió del parque deja de generar alertas
    Given un equipo con custodio inactivo que se registra como perdido
    When se consulta el centro de alertas
    Then ya no aparece entre los equipos con custodio inactivo
    # Un pendiente que nadie puede resolver es un pendiente eterno en la
    # pantalla que debería decir qué atender hoy.

  @AC-EST-010
  Scenario: Lo que salió del parque no se sugiere renovar
    Given un equipo obsoleto que se registra como robado
    When se evalúa su política de renovación
    Then deja de aparecer entre las sugerencias
    # Competiría por el presupuesto de reposición con equipos que sí están en
    # uso, y por un motivo distinto del que dice la sugerencia.

  @AC-EST-011
  Scenario: No se registran reparaciones sobre un equipo que no está
    When se intenta registrar un mantenimiento de un equipo perdido
    Then la solicitud es rechazada

  @AC-EST-012
  Scenario: El panel separa las pérdidas de las bajas
    Given un equipo dado de baja y otro robado
    When se consulta el panel principal
    Then cada uno se cuenta por separado
    # Una baja es una decisión de la empresa; un robo es una pérdida que
    # alguien tiene que investigar. Sumarlos escondería justo eso.

  @AC-EST-013
  Scenario: El expediente de lo que salió sigue siendo consultable
    When se filtra el inventario por lo que está fuera del parque
    Then aparecen los equipos perdidos, robados y dados de baja con su motivo
    # Su expediente es el respaldo de qué pasó con ellos.

  # --- Ubicación física (§4.1) ---

  @AC-UBI-001
  Scenario: La ubicación es un catálogo, no un texto escrito a mano
    When se registra la ubicación de un equipo
    Then se elige de un catálogo de sedes y lugares
    # «Bodega TI», «bodega de TI» y «Bodega  TI» son el mismo sitio para una
    # persona y tres para una consulta: con texto libre, el filtro devuelve un
    # tercio de los equipos que están ahí y nadie nota lo que falta.

  @AC-UBI-002
  Scenario: La ubicación se separa del departamento
    Given un equipo de Contabilidad guardado en la bodega de TI
    When se consulta su ficha
    Then el área y la ubicación son datos distintos
    # El área dice de quién es el presupuesto; la ubicación, dónde ir a
    # buscarlo.

  @AC-UBI-003
  Scenario: No se repite una ubicación dentro de la misma sede
    When se crea una segunda «Bodega TI» en la misma sede
    Then la solicitud es rechazada
    # Serían indistinguibles en el desplegable del formulario.

  @AC-UBI-004
  Scenario: El mismo nombre en otra sede sí es válido
    When se crea «Bodega TI» en una sucursal distinta
    Then se registra sin problema

  @AC-UBI-005
  Scenario: No se cierra una ubicación que todavía tiene equipos
    Given una ubicación con activos dentro
    When se intenta desactivarla
    Then la solicitud es rechazada indicando cuántos equipos hay
    # Quedarían en un sitio que el formulario ya no ofrece: nadie podría
    # corregirlos ni volver a usar el lugar.

  @AC-UBI-006
  Scenario: No se pone un equipo en una ubicación cerrada
    When se intenta registrar un equipo en una ubicación desactivada
    Then la solicitud es rechazada
    # Lo dejaría registrado donde nadie va a buscarlo.

  @AC-UBI-007
  Scenario: Las ubicaciones escritas antes no se pierden
    Given equipos con la ubicación escrita a mano antes del catálogo
    When se migra el sistema
    Then cada texto distinto se convierte en una ubicación del catálogo
    And los equipos quedan apuntando a ella

  @AC-UBI-008
  Scenario: La carga masiva exige una ubicación que exista
    When el archivo trae una ubicación que no está en el catálogo
    Then la fila se reporta con el error, indicando dónde consultar las válidas
    # Crearlas sobre la marcha reintroduciría el texto libre por la puerta de
    # atrás, con las erratas incluidas.

  @AC-UBI-009
  Scenario: Un nombre de ubicación repetido en dos sedes se debe desambiguar
    Given dos sedes con una bodega del mismo nombre
    When el archivo trae solo el nombre
    Then la fila se reporta pidiendo el formato «Sede / Nombre»
    # Resolverlo en silencio repartiría los equipos en el edificio equivocado.

  # --- Clasificación (§12) y fechas (§4.1) ---

  @AC-CLA-001
  Scenario: La criticidad tiene los cuatro niveles del documento
    When se consulta la clasificación disponible
    Then están baja, media, alta y crítica

  @AC-CLA-002
  Scenario: El uso describe la función del equipo, no cuánto se usa
    When se consulta la clasificación disponible
    Then están administrativo, operativo, desarrollo, diseño, gerencial, atención al cliente, bodega e infraestructura
    # Dos laptops idénticas pueden ser una de gerencia y otra de bodega, y eso
    # cambia con qué urgencia se repone cada una.

  @AC-CLA-003
  Scenario: La clasificación arranca en el valor más neutro
    When se registra un equipo sin indicar criticidad
    Then queda como media
    # Un valor por defecto alto haría que todo el parque pareciera crítico, y
    # entonces nada lo sería.

  @AC-CLA-004
  Scenario: La fecha de ingreso se separa de la de compra
    When se registra un equipo comprado en diciembre que entró en marzo
    Then ambas fechas se conservan
    # La garantía corre desde una y la custodia desde la otra.

  @AC-CLA-005
  Scenario: El ingreso no puede ser anterior a la compra
    When se registra un ingreso anterior a la fecha de adquisición
    Then la solicitud es rechazada
    # Al revés no ocurre, y cuando aparece es que una de las dos se digitó mal.

  # --- Filtros (§14) ---

  @AC-FIL-001
  Scenario: Se filtra el inventario por ubicación y por sede
    When se filtra por una ubicación concreta o por toda una sede
    Then el listado devuelve solo los equipos que están ahí
    # «Todo lo que hay en la matriz» es la pregunta de quien va a hacer el
    # inventario físico de un edificio.

  @AC-FIL-002
  Scenario: Se filtra el inventario por antigüedad
    When se filtran los equipos de más de tres años
    Then el listado devuelve solo los adquiridos antes de esa fecha
    # Se resuelve en la consulta y no en memoria: el documento dimensiona
    # entre 5.000 y 10.000 activos.

  @AC-FIL-003
  Scenario: Se filtra por criticidad y por uso
    When se filtra por criticidad crítica o por uso gerencial
    Then el listado devuelve solo los equipos de esa clasificación

  @AC-FIL-004
  Scenario: La exportación arrastra los campos nuevos
    When se exporta el inventario a Excel
    Then el archivo incluye sede, ubicación, criticidad, uso y fecha de ingreso
