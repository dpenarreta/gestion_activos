# Autenticación

## Resumen

La autenticación es JWT (`djangorestframework-simplejwt`), pero la
revocación real no depende del blacklist genérico de esa librería: depende
de un modelo propio, `apps.authentication.models.Session`. Esto permite
revocar una sesión concreta (cerrar sesión, deshabilitar un usuario, forzar
un cambio de contraseña) y que el efecto sea inmediato en la siguiente
request, sin esperar a que el access token expire por sí solo.

## Emisión de tokens

`apps.authentication.tokens.issue_token_pair(user, session)` emite un par
`access`/`refresh` con un único claim propio: `sid` (el UUID de la
`Session`). El token **nunca** lleva password, permisos ni ningún dato
sensible — los permisos se consultan aparte, en `GET /api/v1/auth/me/`.

```python
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=JWT_ACCESS_TOKEN_LIFETIME_MINUTES),  # default 15
    "REFRESH_TOKEN_LIFETIME": timedelta(days=JWT_REFRESH_TOKEN_LIFETIME_DAYS),      # default 7
    "ROTATE_REFRESH_TOKENS": False,   # la rotación la gestiona Session, no simplejwt
    "SIGNING_KEY": JWT_SECRET_KEY,    # obligatorio por variable de entorno
}
```

## Validación en cada request

`apps.authentication.authentication.SessionAuthentication` extiende
`JWTAuthentication` y, además de lo que esta ya valida (firma, expiración,
`user.is_active`), exige:

1. Que el token tenga el claim `sid`.
2. Que exista una `Session` con ese id, perteneciente al mismo usuario.
3. Que esa `Session` siga activa (`revoked_at is None` y no expirada).
4. Que no lleve más de `SESSION_IDLE_TIMEOUT` sin usarse (4 h por defecto).

Si cualquiera de estas condiciones falla, la request se rechaza con 401
(`token_not_valid`, `session_revoked` o `session_idle_timeout`).

Cuando pasa la validación, la petición **reinicia la cuenta de inactividad**
(`Session.registrar_uso`). Para no hacer un UPDATE por cada petición de cada
usuario, la marca se reescribe como mucho cada `SESSION_ACTIVITY_WRITE_EVERY`
(60 s por defecto): el corte puede adelantarse ese minuto sobre el plazo, que
en cuatro horas no cambia nada de lo que el plazo protege.

## Cierre por inactividad

El refresh token dura días; sin un plazo de inactividad, una sesión abierta en
un equipo compartido sigue sirviendo al día siguiente. El plazo es
**deslizante**: no mide cuánto lleva abierta la sesión sino cuánto lleva sin
usarse, así que cualquier petición dentro del plazo lo empieza de nuevo.

Al vencer, la sesión **se revoca**, no se rechaza y ya: dejarla abierta haría
que el refresh token siguiera valiendo y que la siguiente petición la
reviviera. El frontend reconoce el código `session_idle_timeout`, va directo al
login sin intentar renovar —el refresh responde lo mismo— y dice por qué
(`/login?motivo=inactividad`).

**Renovar el token no cuenta como actividad**: lo hace el navegador, no la
persona. Lo que reinicia la cuenta es la petición que provocó ese 401, que sí
pidió alguien. Si contara, una pestaña olvidada abierta mantendría la sesión
viva sin nadie delante.

`expires_at` sigue siendo el techo absoluto: ni usándola sin parar, una sesión
dura más que el refresh token.

## Renovación (`POST /api/v1/auth/token/refresh/`)

`AuthenticationService.refresh_tokens`:

1. Busca la `Session` por el claim `sid` del refresh token presentado.
2. Si la sesión venció por inactividad, la revoca y responde
   `session_idle_timeout` (renovar no puede resucitar lo que el plazo cerró).
3. Si el `jti` del refresh presentado no coincide con
   `session.refresh_token_jti` (el último emitido), asume que es un token
   ya rotado que se está reutilizando: **revoca toda la sesión** como
   medida de contención ante un posible robo, y responde `refresh_reused`.
4. Si todo es válido, emite un nuevo par de tokens y actualiza
   `refresh_token_jti` —sin tocar `last_used_at`, ver más arriba—.

## Cambio de contraseña obligatorio (`must_change_password`)

Un administrador puede forzar que un usuario cambie su contraseña en el
próximo inicio de sesión (`POST /api/v1/admin/users/{id}/password-reset/`
con `force_change_on_next_login: true`). Mientras ese flag esté activo,
`SessionAuthentication.authenticate()` rechaza **cualquier** request cuya
ruta no esté en una lista corta de excepciones
(`/auth/password/change/`, `/auth/logout/`, `/auth/logout-all/`,
`/auth/me/`), con `403 password_change_required`. El frontend intercepta
ese código (`src/api/client.js`) y redirige a `/change-password-required`.

## Recuperación de contraseña autoservicio

`apps.authentication.services.PasswordResetService`:

- `request_reset`: nunca revela si la cuenta existe — responde el mismo
  mensaje genérico exista o no, esté activa o no. Solo genera un token
  (SHA-256 del valor aleatorio, el crudo solo viaja en el correo) si la
  cuenta existe y está activa.
- `confirm_reset`: valida que el token exista, no esté usado y no haya
  expirado; si es válido, cambia la contraseña, revoca **todas** las
  sesiones activas del usuario, y envía una notificación de confirmación.

## Restablecimiento administrativo

`PasswordResetService.admin_initiate_reset` — **el administrador nunca ve
ni define la nueva contraseña**. Solo puede combinar tres acciones
independientes: enviar un enlace de recuperación, forzar cambio en el
próximo inicio, y/o revocar las sesiones activas. Al menos una debe
elegirse (`AdminPasswordResetSerializer.validate`).

## Protección contra fuerza bruta

`BruteForceProtectionService` cuenta intentos fallidos por *identificador
tecleado* (no por usuario resuelto), en una ventana de
`LOGIN_LOCKOUT_MINUTES` minutos; al superar `LOGIN_MAX_FAILED_ATTEMPTS`,
bloquea incluso un intento con la contraseña correcta. Cuando el
identificador no resuelve a ningún usuario, se ejecuta igualmente un
`check_password` contra un hash señuelo precalculado, para que el tiempo de
respuesta no delate si la cuenta existe.

## Endpoints

| Método | Ruta | Auth | Propósito |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login/` | Pública | Inicio de sesión |
| POST | `/api/v1/auth/token/refresh/` | Pública | Renovar tokens |
| POST | `/api/v1/auth/logout/` | Requerida | Cerrar la sesión actual |
| POST | `/api/v1/auth/logout-all/` | Requerida | Cerrar todas las sesiones |
| GET | `/api/v1/auth/sessions/` | Requerida | Listar sesiones activas propias |
| GET | `/api/v1/auth/me/` | Requerida | Perfil propio + permisos vigentes |
| POST | `/api/v1/auth/password-reset/request/` | Pública | Solicitar recuperación |
| POST | `/api/v1/auth/password-reset/confirm/` | Pública | Confirmar recuperación con token |
| POST | `/api/v1/auth/password/change/` | Requerida | Cambiar la propia contraseña |

**No hay registro público.** Se retiró en la revisión de seguridad del 10 de
septiembre de 2026: es el inventario interno de un grupo empresarial y no hay
ningún caso en que alguien se dé de alta a sí mismo. El endpoint además emitía
tokens en el acto —un desconocido obtenía sesión válida contra la API— y eludía
la nomenclatura de nombre de usuario que el alta administrativa sí impone. Las
cuentas las crea un administrador desde Usuarios, con su empresa y su rol.
