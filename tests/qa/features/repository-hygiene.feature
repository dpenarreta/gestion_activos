# language: es
Característica: Higiene del repositorio
  Como responsable del sistema Gestión de Activos
  Quiero que ningún secreto real llegue al repositorio
  Para que publicar el código no exponga credenciales

  @AC-025
  Escenario: No existen credenciales reales versionadas
    Dado el contenido versionado del repositorio
    Cuando se buscan valores de SECRET_KEY, JWT_SECRET_KEY y DB_PASSWORD
    Entonces ningún archivo rastreado contiene un secreto real
    Y los archivos ".env" están excluidos por ".gitignore"

  @AC-026
  Escenario: Existen archivos .env.example seguros
    Dado el repositorio del proyecto
    Cuando se listan los archivos de ejemplo de entorno
    Entonces existen ".env.example" en la raíz, en "backend/" y en "frontend/"
    Y ninguno contiene un valor real, solo marcadores de posición
