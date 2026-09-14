# language: es
Característica: Aplicación instalable en el teléfono (§20)

  El §20 pide una aplicación móvil y el §25 la prioriza como baja. Lo que se
  hizo no es una aplicación aparte: es la misma, instalable. La diferencia
  importa, porque una aplicación nativa serían dos bases de código que hay que
  mantener iguales, y lo que el inventario físico necesita del teléfono ya está
  construido —el escáner, la ficha, «mis equipos»—; lo que faltaba era poder
  llevarlo sin un navegador delante.

  La decisión que manda sobre todas las demás es qué NO se guarda: ninguna
  respuesta de la API. Un inventario que enseña lo de ayer es peor que uno que
  dice «no hay conexión», porque el segundo se nota y el primero no.

  @AC-PWA-001
  Escenario: El teléfono ofrece instalarla
    Dado el sistema servido sobre HTTPS
    Cuando se abre desde un teléfono
    Entonces el navegador ofrece añadirla a la pantalla de inicio
    Y se abre sin barra de direcciones, como una aplicación

  @AC-PWA-002
  Escenario: Abre donde se trabaja, no en la portada
    Cuando se abre desde la pantalla de inicio
    Entonces entra en el panel, y cada quien cae en su primera pantalla visible

  @AC-PWA-003
  Escenario: Los atajos llevan a lo que se hace con el teléfono en la mano
    Cuando se mantiene pulsado el icono
    Entonces se ofrecen la consulta por escáner y «mis equipos»
    # Son los dos usos que justifican llevarla en el bolsillo: el inventario
    # físico y saber qué tiene uno a su cargo.

  @AC-PWA-004
  Escenario: Sin conexión lo dice con sus palabras
    Dado un teléfono sin señal, dentro de una bodega
    Cuando se abre la aplicación
    Entonces explica que no hay conexión y por qué no enseña el inventario guardado
    Y vuelve sola en cuanto regresa la red
    # El error del navegador no dice nada de este sistema, y deja a quien está
    # en el andén sin saber si el problema es suyo, del teléfono o del servidor.

  @AC-PWA-005
  Escenario: El inventario nunca se sirve de la caché
    Dado un teléfono sin señal
    Cuando la aplicación pide datos al servidor
    Entonces la petición falla, en vez de responder con datos guardados
    # Es la decisión central: alguien lee que el equipo está en Quito, viaja, y
    # estaba en Guayaquil desde el martes. Un error se nota; un dato viejo, no.

  @AC-PWA-006
  Escenario: Un despliegue nuevo se ve al instante
    Dado un teléfono con la aplicación ya instalada
    Cuando se publica una versión nueva
    Entonces al abrirla se carga la nueva, sin desinstalar nada
    Y las copias del armazón anterior se borran
    # Sin esto, el teléfono acumula una copia por despliegue y acaba
    # arrancando una versión que ya nadie reconoce.

  @AC-PWA-007
  Escenario: En desarrollo no se instala nada
    Cuando se trabaja contra el servidor de desarrollo
    Entonces no se registra el service worker
    # Vite sirve los módulos sin hash en el nombre: un armazón guardado
    # devolvería el de la sesión anterior después de cada cambio, y eso es
    # media hora persiguiendo un fallo que no existe.
