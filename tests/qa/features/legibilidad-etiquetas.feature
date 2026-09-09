Feature: Etiquetas legibles con pistola (RF-08 y §5 del documento funcional)
  Como técnico de soporte
  Quiero que la etiqueta impresa se lea al primer disparo
  Para inventariar un estante sin pelearme con el lector

  @AC-COD-001
  Scenario: El identificador es un código de barras 1D, no un QR
    When se emite la etiqueta de un activo
    Then el símbolo es un Code 128
    # El QR necesita cámara y enfoque; el inventario se hace con una pistola
    # láser en la mano recorriendo estantes.

  @AC-COD-002
  Scenario: La barra más fina no baja del mínimo legible
    When se mide el símbolo que se va a imprimir
    Then el ancho de módulo es de al menos dos puntos de impresora
    # Por debajo, una pistola de gama común falla sobre plástico curvo.

  @AC-COD-003
  Scenario: El ancho de módulo es múltiplo del punto de impresora
    When se mide el símbolo que se va a imprimir
    Then su ancho es un múltiplo exacto del punto a 203 dpi
    # Si no lo fuera, la térmica redondearía cada barra por su cuenta y
    # deformaría la proporción entre anchas y estrechas, que es lo que el
    # lector decodifica.

  @AC-COD-004
  Scenario: El símbolo lleva zona muda a los lados
    When se mide el símbolo que se va a imprimir
    Then hay al menos diez módulos en blanco antes y después de las barras
    # Es la causa más frecuente de que una etiqueta «no se deje leer»: sin
    # blanco delante, el lector no encuentra dónde empieza el símbolo.

  @AC-COD-005
  Scenario: El código del sistema cabe en la etiqueta que se usa
    Given el formato de código GA-<TIPO>-<SECUENCIA>
    When se mide el símbolo sobre una etiqueta de 50 × 25 mm
    Then cabe con su zona muda sin bajar del mínimo legible

  @AC-COD-006
  Scenario: Un código más largo avisa antes de imprimir el lote
    Given un código que no cabe con calidad en la etiqueta
    When se consulta su medición
    Then el sistema advierte que hay que usar una etiqueta más ancha
    # Mejor saberlo antes de imprimir doscientas que con el lector en la mano.

  @AC-COD-007
  Scenario: El PDF se emite a tamaño físico real
    When se descarga la etiqueta en PDF
    Then la página mide lo que mide la etiqueta
    # Si no, imprimir «ajustar a la página» reescalaría el símbolo y todas las
    # medidas dejarían de valer.

  @AC-COD-008
  Scenario: El valor va también en texto bajo las barras
    When se emite la etiqueta
    Then el código aparece impreso en caracteres legibles
    # Si la etiqueta se raya o el lector falla, se puede teclear o dictar.

  @AC-COD-009
  Scenario: La lectura funciona con cualquier pistola de teclado
    Given una pistola configurada con sufijo Enter
    When se dispara sobre la etiqueta en la pantalla del escáner
    Then el sistema busca el equipo sin pulsar nada más
    And el campo queda limpio para el siguiente disparo
    # Sin limpiarlo, el segundo escaneo se concatenaría al primero y produciría
    # un código inexistente.

  @AC-COD-010
  Scenario: También se puede buscar por número de serie
    Given un equipo cuya etiqueta se arrancó
    When se teclea el número de serie del fabricante
    Then el sistema devuelve la misma ficha
