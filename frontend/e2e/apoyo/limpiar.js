import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { enElBackend } from "./backend.js";
import { CUENTA } from "./preparar.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const AUTH = path.resolve(AQUI, "../.auth");

/**
 * Retira lo que la ejecución dejó puesto.
 *
 * Se borran tres cosas y solo tres: la cuenta de pruebas, su grupo y los
 * equipos que estas pruebas crearon —reconocibles porque su nombre empieza por
 * `E2E-`, un prefijo que ningún equipo real lleva—. Lo demás se queda: un
 * `teardown` que borra de más es peor que uno que borra de menos, porque la
 * base de desarrollo también es donde se está mirando la aplicación.
 *
 * Un activo no se elimina desde la aplicación —se da de baja, para no perder su
 * historia—, así que aquí se borra por debajo: son datos que nacieron en una
 * prueba y conservarlos solo ensuciaría el inventario con el que se trabaja.
 */
export default function limpiar() {
  const salida = enElBackend(`
from django.contrib.auth.models import Group
from apps.activos.models import Activo
from apps.authentication.models import LoginAttempt
from apps.users.models import User

equipos = Activo.objects.todas().filter(nombre__startswith="E2E-")
borrados = equipos.count()
for equipo in equipos:
    equipo.movimientos.all().delete()
    equipo.mantenimientos.all().delete()
    equipo.delete()

LoginAttempt.objects.filter(identifier__startswith="e2e_").delete()
User.objects.filter(username__startswith="${CUENTA}").delete()
Group.objects.filter(name="E2E (temporal)").delete()
print(f"E2E: retirados {borrados} equipo(s) de prueba y la cuenta.")
`);
  process.stdout.write(
    salida
      .split("\n")
      .filter((l) => l.startsWith("E2E:"))
      .join("\n") + "\n",
  );

  fs.rmSync(AUTH, { recursive: true, force: true });
}
