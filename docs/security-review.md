# Revisión de seguridad

Checklist de la sección 11 del prompt de partición, con el estado real de
cada punto en este repositorio.

| Control | Estado | Detalle |
| --- | --- | --- |
| Hash seguro de contraseñas | ✅ | Argon2 (`PASSWORD_HASHERS`), PBKDF2 solo como fallback de lectura |
| JWT firmado con secreto de entorno | ✅ | `JWT_SECRET_KEY` obligatorio, valida al arranque (`_fail_fast_on_missing_env`) |
| Expiración de tokens | ✅ | `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` / `JWT_REFRESH_TOKEN_LIFETIME_DAYS`, configurables |
| Validación de permisos en backend | ✅ | `HasModulePermission` en toda vista administrativa; el frontend nunca es la única barrera |
| Validación de entradas | ✅ | Serializers DRF en cada endpoint de escritura |
| Manejo seguro de errores | ✅ | `api_exception_handler` uniforme, nunca expone detalles internos en un 500 |
| Protección CSRF | ✅ (donde aplica) | La API usa JWT Bearer sin cookies de sesión (no aplica); el admin de Django sí usa `CsrfViewMiddleware` |
| CORS restrictivo | ✅ | `CORS_ALLOWED_ORIGINS` explícito por entorno, sin comodín |
| Cookies seguras | ✅ (producción) | `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` forzados en `production.py` |
| Sin credenciales en código | ✅ | Todo secreto por variable de entorno; verificado con `grep` manual (ver limitación abajo) |
| Sin datos personales en logs | ✅ | `AccessLogMiddleware` solo registra método/ruta/estado/duración |
| Sin tokens completos en logs | ✅ | Igual que arriba; auditoría enmascara campos sensibles (`mask_sensitive_fields`) |
| Protección contra fuerza bruta | ✅ | `BruteForceProtectionService`, bloqueo por identificador + throttle por IP (`login` scope) |
| Encabezados de seguridad | ✅ | `SECURE_CONTENT_TYPE_NOSNIFF`, `X_FRAME_OPTIONS=DENY`, `SECURE_REFERRER_POLICY`, HSTS en producción |
| Dependencias sin vulnerabilidades críticas conocidas | ⚠️ Parcial | No se ejecutó `pip-audit`/`npm audit` con corrección de hallazgos en esta sesión (`npm install` reportó 9 vulnerabilidades de severidad moderada/alta en dependencias transitivas de tooling de desarrollo — ver limitación abajo) |
| Auditoría de acciones administrativas | ✅ | `AuditLog` append-only, cubre creación/edición/activación/asignación de roles y permisos, cambios de tema |
| Protección del último administrador | ✅ | AC-038, construido específicamente para este template (no existía en el original) |
| Baja lógica en vez de eliminación física | ✅ | `UserAdminViewSet` sin `DELETE`; roles sí se eliminan físicamente (son configuración, no cuentas con historial) |

## Limitaciones conocidas (no ocultas)

- **`npm audit`** reportó 9 vulnerabilidades (2 moderadas, 7 altas) en el
  árbol de dependencias del frontend al instalar. Son, en su totalidad,
  dependencias transitivas de herramientas de *build/desarrollo* (Vite/
  Vitest y su cadena), no del código que se envía al navegador. No se
  ejecutó `npm audit fix` en esta sesión porque el flag `--force` de esa
  corrección suele forzar downgrades/upgrades mayores de Vite/Vitest que
  podrían romper el proyecto sin una validación manual adicional — se deja
  como acción pendiente explícita, no oculta.
- **`pip-audit`** no se ejecutó contra el `requirements/base.txt` del
  backend en esta sesión.
- La búsqueda de secretos fue un `grep` manual de patrones obvios
  (`password=`, `SECRET`, `-----BEGIN`), no una herramienta dedicada como
  `gitleaks`/`truffleHog`.

## Recomendaciones para un despliegue productivo real

1. Ejecutar `pip-audit` y `npm audit` (con revisión manual de cada
   corrección propuesta) antes de cada release.
2. Rotar `SECRET_KEY`/`JWT_SECRET_KEY` si alguna vez se sospecha una
   filtración, y forzar `logout-all` de todos los usuarios (revocar todas
   las `Session`).
3. Configurar un proveedor de correo real (`EMAIL_BACKEND`) — por defecto
   usa el backend de consola, adecuado solo para desarrollo.
4. Configurar `CSRF_TRUSTED_ORIGINS` si el admin de Django se sirve detrás
   de un dominio/proxy distinto al de origen.
