# Revisión de seguridad

Checklist de controles de seguridad heredados de la plantilla base
(`docs/plantilla/`), con el estado real de cada punto verificado en este
repositorio. **Este documento es el criterio de seguridad del proyecto:**
todo módulo de negocio nuevo debe cumplirlo, y cualquier control que se
relaje debe quedar registrado aquí como limitación, no omitido.

Última verificación: 2026-09-08 (arranque del proyecto).

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
| Dependencias sin vulnerabilidades críticas conocidas | ✅ | `pip-audit` y `npm audit` ejecutados el 2026-09-08 con corrección de todos los hallazgos: **0 vulnerabilidades conocidas** en backend y frontend (ver "Correcciones aplicadas" abajo) |
| Secretos del `.env` no truncados al parsearse | ✅ | `django-environ` corta el valor en `#`: los secretos generados excluyen ese carácter. Un `DB_PASSWORD` con `#` produce un "Login failed" difícil de diagnosticar |
| Auditoría de acciones administrativas | ✅ | `AuditLog` append-only, cubre creación/edición/activación/asignación de roles y permisos, cambios de tema |
| Protección del último administrador | ✅ | AC-038, construido específicamente para esta base (no existía en el original) |
| Baja lógica en vez de eliminación física | ✅ | `UserAdminViewSet` sin `DELETE`; roles sí se eliminan físicamente (son configuración, no cuentas con historial) |

## Correcciones aplicadas al adoptar la base (2026-09-08)

La plantilla dejaba la auditoría de dependencias como pendiente explícito.
Se ejecutó y se corrigió todo lo encontrado:

| Hallazgo | Severidad | Acción |
| --- | --- | --- |
| `Django 5.1.15` — 7 CVE, rama sin soporte (los parches salen en 5.2.x/6.0.x) | Alta | Actualizado a **5.2.17 LTS** |
| `djangorestframework 3.15.2` — CVE-2026-73228, CVE-2026-73229 | Alta | Actualizado a **3.17.2** |
| `mssql-django 1.7.4` — sin soporte declarado para Django 5.2 | — | Actualizado a **1.8.0** |
| `react-router 6.28` — open redirect vía backslash en `<Link>`/`useNavigate` (GHSA-wrjc-x8rr-h8h6) | Moderada, **runtime** | Actualizado a **react-router-dom 7.18.3** (el proyecto solo usa el modo declarativo, migración sin cambios de código) |
| `brace-expansion`, `js-yaml`, `nanoid` — DoS/consumo de CPU | Alta, solo tooling | Resueltos con `npm audit fix` |

Verificación posterior: `pip-audit` y `npm audit` reportan **0
vulnerabilidades**; las 83 pruebas del backend, los 13 escenarios Gherkin,
las 10 pruebas del frontend, el lint y el build de producción siguen en
verde.

También se corrigió un defecto de la plantilla que impedía instalarla
desde cero: `roles/0001_initial` daba por existente el `ContentType` de
`permissions.ModulePermission`, que Django recién crea en `post_migrate`
(al final de todo el `migrate`). Sobre una base de datos vacía la migración
fallaba; ahora materializa el ContentType y los permisos desde el catálogo
de forma idempotente.

## Limitaciones conocidas (no ocultas)

- La búsqueda de secretos fue un `grep` manual de patrones obvios
  (`password=`, `SECRET`, `-----BEGIN`), no una herramienta dedicada como
  `gitleaks`/`truffleHog`.
- `pip-audit` y `npm audit` solo detectan vulnerabilidades **publicadas**:
  hay que volver a ejecutarlos antes de cada release, no una sola vez.
- El módulo de negocio del sistema (activos) todavía no existe, así que
  ningún control de esta lista ha sido probado contra datos de dominio
  reales.

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
