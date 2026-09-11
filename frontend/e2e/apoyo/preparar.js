import { chromium } from "@playwright/test";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { enElBackend, imprimirJson, leerJson } from "./backend.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SESION = path.resolve(AQUI, "../.auth/sesion.json");
const DATOS = path.resolve(AQUI, "../.auth/datos.json");

/** Prefijo de todo lo que crean estas pruebas, para poder retirarlo después. */
export const CUENTA = "e2e_bot";

/**
 * Deja el sistema listo para las pruebas y guarda la sesión iniciada.
 *
 * La cuenta se crea aquí y se borra al terminar, con una **contraseña distinta
 * en cada ejecución**: una credencial fija en el repositorio acaba, antes o
 * después, en una base que no es la de pruebas. Por si algo interrumpe el
 * cierre, `verificar_despliegue` avisa de las cuentas que empiezan por
 * `e2e_`.
 *
 * Se entra por la interfaz —no inyectando un token— porque el inicio de sesión
 * es el primer recorrido que hay que proteger: si se rompiera, todo lo demás
 * daría igual.
 */
export default async function preparar(config) {
  const baseURL = config.projects[0].use.baseURL;
  const clave = randomBytes(18).toString("base64url");

  await comprobarQueRespondan(baseURL);
  const contexto = crearCuenta(clave);

  fs.mkdirSync(path.dirname(SESION), { recursive: true });
  fs.writeFileSync(DATOS, JSON.stringify({ ...contexto, usuario: CUENTA }));

  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ baseURL });
  try {
    await entrar(pagina, baseURL, clave);
    await pagina.context().storageState({ path: SESION });
  } finally {
    await navegador.close();
  }
}

/**
 * Entra por la interfaz y espera a estar dentro.
 *
 * El inicio de sesión está limitado a diez intentos por minuto —una defensa
 * contra la fuerza bruta, no un fallo—, y correr la suite varias veces seguidas
 * mientras se depura agota ese margen. Cuando ocurre, el formulario se queda
 * donde está y sin este rodeo el síntoma es un tiempo de espera agotado que no
 * dice nada. Se espera una vez a que el minuto pase, y a la segunda se explica.
 */
async function entrar(pagina, baseURL, clave, esReintento = false) {
  await pagina.goto(`${baseURL}/login`);
  await pagina.getByLabel("Usuario o correo").fill(CUENTA);
  await pagina.getByLabel("Contraseña").fill(clave);
  await pagina.getByRole("button", { name: "Entrar" }).click();

  // Entrar deja al usuario en la portada, no en el panel: lo que dice que la
  // sesión quedó abierta es haber salido del login.
  const dentro = pagina
    .waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 20_000,
    })
    .then(() => null);
  const rechazo = pagina
    .locator(".alert-danger")
    .waitFor({ timeout: 20_000 })
    .then(() => pagina.locator(".alert-danger").innerText());

  const motivo = await Promise.race([dentro, rechazo]).catch(
    () => "sin respuesta",
  );
  if (motivo === null) {
    return;
  }
  if (esReintento) {
    throw new Error(`No se pudo entrar con la cuenta de pruebas: ${motivo}`);
  }
  process.stdout.write(
    `E2E: el login rechazó el intento (${motivo.trim()}). ` +
      "Se reintenta en un minuto, que es la ventana del límite de intentos.\n",
  );
  await new Promise((listo) => setTimeout(listo, 61_000));
  await entrar(pagina, baseURL, clave, true);
}

async function comprobarQueRespondan(baseURL) {
  for (const [nombre, url] of [
    ["el frontend", baseURL],
    ["el backend", "http://localhost:8010/api/v1/health/"],
  ]) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(5000) });
    } catch {
      throw new Error(
        `No responde ${nombre} en ${url}. Estas pruebas usan los servidores de ` +
          "desarrollo ya levantados; arránquelos antes (backend en 8010, frontend en 5174).",
      );
    }
  }
}

/**
 * La cuenta con la que corren las pruebas, con todos los permisos del catálogo.
 *
 * Todos a propósito: qué ve cada rol ya lo prueban a fondo las de pytest y las
 * de componentes, y aquí un permiso que falte se manifestaría como un recorrido
 * roto que cuesta media hora entender.
 */
function crearCuenta(clave) {
  const codigo = `
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from apps.empresas.models import Empresa, MembresiaEmpresa
from apps.permissions.catalog import all_codenames
from apps.permissions.models import ModulePermission
from apps.authentication.models import LoginAttempt
from apps.users.models import User

usuario, _ = User.objects.get_or_create(
    username="${CUENTA}", defaults={"email": "${CUENTA}@pruebas.local"}
)
usuario.set_password("${clave}")
usuario.is_active = True
usuario.must_change_password = False
usuario.save()

tipo = ContentType.objects.get_for_model(ModulePermission)
grupo, _ = Group.objects.get_or_create(name="E2E (temporal)")
grupo.permissions.set(
    Permission.objects.filter(content_type=tipo, codename__in=all_codenames())
)
usuario.groups.set([grupo])

# Los intentos fallidos se cuentan por identificador y bloquean quince
# minutos: la propia prueba del login equivocado gasta dos por ejecución, y sin
# esto la tercera pasada del día no podría ni entrar. Se borran los de las
# cuentas de prueba —solo esas— antes de empezar.
LoginAttempt.objects.filter(identifier__startswith="e2e_").delete()

empresas = list(Empresa.objects.filter(activa=True).order_by("id"))
MembresiaEmpresa.objects.filter(usuario=usuario).delete()
for indice, empresa in enumerate(empresas):
    MembresiaEmpresa.objects.create(
        usuario=usuario, empresa=empresa, es_predeterminada=indice == 0
    )

${imprimirJson('{"empresas": [{"id": e.id, "nombre": e.nombre} for e in empresas]}')}
`;
  return leerJson(enElBackend(codigo));
}
