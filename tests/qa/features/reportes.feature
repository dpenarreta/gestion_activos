Feature: Reportes y exportación (§16 del documento funcional)
  Como responsable de TI
  Quiero sacar del sistema los reportes que me piden, en el formato que me piden
  Para no tener que armarlos a mano en una hoja de cálculo cada vez

  @AC-REP-001
  Scenario: Están los trece reportes del documento
    When se consulta el catálogo de reportes
    Then aparecen los trece: inventario general, por área, por usuario, por ubicación, disponibles, en reparación, dados de baja, por antigüedad, próximos a reemplazo, historial de asignaciones, historial de reparaciones, garantías por vencer y costos de mantenimiento

  @AC-REP-002
  Scenario: Cada reporte se puede sacar en los tres formatos
    When se descarga cualquier reporte
    Then se obtiene en Excel, CSV o PDF, según lo pedido

  @AC-REP-003
  Scenario: El catálogo dice qué se puede filtrar en cada reporte
    When se consulta el catálogo
    Then cada reporte declara sus parámetros y sus columnas
    # La pantalla se dibuja a partir de eso: un reporte nuevo aparece en la
    # interfaz sin tocar el frontend.

  @AC-REP-004
  Scenario: Lo que salió del parque no ensucia los reportes operativos
    Given un equipo robado
    When se consulta el reporte de activos por área
    Then no aparece
    # Haría creer que el área todavía lo tiene.

  @AC-REP-005
  Scenario: El inventario general sí es el censo completo
    Given un equipo robado
    When se consulta el inventario general
    Then aparece, con su estado
    # Es el censo de todo lo que se registró alguna vez, no la foto de hoy.

  @AC-REP-006
  Scenario: El reporte de bajas reúne las tres salidas
    Given equipos dados de baja, perdidos y robados
    When se consulta el reporte de activos dados de baja
    Then aparecen los tres, cada uno con su motivo
    # Para el inventario los tres ya no están, y distinguir el robo de la baja
    # es justamente para lo que sirve la columna «motivo».

  @AC-REP-007
  Scenario: El reporte por usuario excluye lo que no está asignado
    When se consulta el reporte de activos por usuario
    Then solo aparecen los equipos con custodio
    # Sin custodio no hay a quién reclamarle: lo no asignado es otro reporte,
    # con otra acción detrás.

  @AC-REP-008
  Scenario: Los reportes de período respetan las fechas pedidas
    Given intervenciones en dos meses distintos
    When se consulta el historial de reparaciones acotado a un mes
    Then solo aparecen las de ese mes

  @AC-REP-009
  Scenario: Un parámetro ilegible no rompe el reporte
    When se pide un reporte con una fecha que no se entiende
    Then el reporte se genera ignorando ese filtro
    # Un error 400 porque alguien escribió «ayer» es más molesto que un
    # reporte con el período completo.

  @AC-REP-010
  Scenario: El reporte de costos trae el total del período
    When se consulta el reporte de costos de mantenimiento
    Then el archivo incluye la suma al pie
    # Un reporte de costos sin total obliga a sumarlo a mano, que es
    # exactamente lo que se venía a evitar.

  @AC-REP-011
  Scenario: Cada archivo dice de qué período es y con qué filtros se sacó
    When se descarga un reporte
    Then el archivo lleva su nombre, la fecha de emisión, el total de filas y los filtros aplicados
    # Un archivo que circula por correo sin ese contexto se interpreta como si
    # fuera el parque completo.

  @AC-REP-012
  Scenario: Un reporte demasiado largo avisa de que se cortó
    Given un reporte con más filas de las que admite el formato
    When se descarga
    Then el archivo indica cuántas filas se incluyeron de cuántas hay
    # Un reporte truncado en silencio se lee como si el parque fuera menor.

  @AC-REP-013
  Scenario: El PDF lleva menos columnas que el Excel
    When se descarga un reporte en PDF
    Then incluye un subconjunto de columnas
    # El PDF es para imprimir y revisar; una tabla de dieciocho columnas en A4
    # sale ilegible aunque quepa. El análisis se hace en el .xlsx.

  @AC-REP-014
  Scenario: Ver un reporte no habilita a descargarlo
    Given un usuario que solo puede consultar reportes
    When intenta descargar uno
    Then la solicitud es rechazada
    # El archivo sale del sistema, circula por correo y se archiva en equipos
    # donde no rigen los permisos que protegen la pantalla.

  @AC-REP-015
  Scenario: Cada descarga queda auditada
    When alguien descarga un reporte
    Then el registro de auditoría guarda quién, qué reporte, en qué formato y con qué filtros

  @AC-REP-016
  Scenario: El CSV se abre sin destrozar los acentos
    When se descarga un reporte en CSV
    Then el archivo lleva la marca de codificación UTF-8
    # Sin ella «Ubicación» llega como «UbicaciÃ³n» y el reporte parece corrupto.
