import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(AQUI, "../../../backend");
const PYTHON = path.join(BACKEND, ".venv", "Scripts", "python.exe");

/**
 * Ejecuta código Django en el backend que estas pruebas están usando.
 *
 * Las pruebas de extremo a extremo necesitan preparar y retirar cosas que la
 * interfaz no ofrece —una cuenta con la que entrar, el borrado de lo que se
 * creó— y la alternativa era dejar esos datos puestos a mano en la base, que
 * es justo lo que hace que una suite funcione en una máquina y en otra no.
 *
 * Se hace por `manage.py shell` y no por la API porque para llamar a la API
 * haría falta ya estar dentro, que es el huevo y la gallina de la primera
 * prueba.
 */
export function enElBackend(codigo) {
  return execFileSync(PYTHON, ["manage.py", "shell", "-c", codigo], {
    cwd: BACKEND,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Lo que `enElBackend` imprimió entre marcas, ya como objeto.
 *
 * `manage.py shell` escribe una cabecera propia («31 objects imported…») antes
 * de lo que uno pide, así que el resultado se envuelve para poder recortarlo
 * sin depender de cuántas líneas traiga esa cabecera.
 */
export function leerJson(salida) {
  const inicio = salida.indexOf("<<<E2E");
  const fin = salida.indexOf("E2E>>>");
  if (inicio === -1 || fin === -1) {
    throw new Error(`El backend no devolvió datos:\n${salida}`);
  }
  return JSON.parse(salida.slice(inicio + "<<<E2E".length, fin));
}

/** Envuelve un valor de Python en las marcas que `leerJson` busca. */
export function imprimirJson(expresion) {
  return `import json; print("<<<E2E" + json.dumps(${expresion}) + "E2E>>>")`;
}
