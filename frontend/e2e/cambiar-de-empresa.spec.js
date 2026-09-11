import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buscarEnElInventario, registrarEquipo } from "./apoyo/pantallas.js";

/*
 * Cambiar de empresa cambia de dónde salen los datos.
 *
 * Es la prueba que más justifica esta capa. El aislamiento se sostiene en tres
 * piezas que solo se tocan a la vez en un navegador de verdad: la cabecera
 * `X-Empresa` que el cliente HTTP añade a cada petición, el gestor por defecto
 * de cada modelo que filtra en el backend, y la recarga completa de la
 * aplicación al cambiar —sin ella, media docena de pantallas seguirían
 * mostrando en memoria lo de la empresa anterior—.
 *
 * Las pruebas de backend ya demuestran que una empresa no ve lo de otra. Lo
 * que solo se puede comprobar aquí es que el selector del menú realmente
 * cambie de mundo.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATOS = path.resolve(AQUI, ".auth/datos.json");

const { empresas } = JSON.parse(fs.readFileSync(DATOS, "utf8"));
const [PRIMERA, SEGUNDA] = empresas;

// Con una sola empresa no hay selector que probar, y no habría nada que decir:
// se anuncia el salto en vez de pasar en verde sin haber mirado nada.
test.skip(
  empresas.length < 2,
  "hace falta más de una empresa para probar el cambio",
);

test.describe("El selector de empresa", () => {
  test("está a la vista antes de mirar nada", async ({ page }) => {
    /* Va debajo del logo y encima del menú a propósito: es el ámbito de todo
       lo que viene después, y verlo antes de navegar evita el error de mirar
       el inventario equivocado durante un rato. */
    await page.goto("/admin/dashboard");

    await expect(page.getByLabel("Empresa")).toBeVisible();
    await expect(page.getByLabel("Empresa")).toHaveValue(String(PRIMERA.id));
  });

  test("un equipo de una empresa no existe en la otra", async ({ page }) => {
    /* Se registra un equipo con un nombre que solo puede ser de esta
       ejecución y se lo busca desde la otra empresa. Comparar los códigos de
       barras de las dos no serviría: cada empresa numera los suyos desde el
       uno, así que `GA-LAP-000001` existe en las dos y son equipos distintos.
       Eso es por diseño, y es justo lo que haría pasar por bueno un filtro
       roto. */
    const serie = `SN-E2E-${Date.now()}`;
    await registrarEquipo(page, { nombre: `E2E-${serie}`, serie });

    await cambiarAEmpresa(page, SEGUNDA);
    await expect(await buscarEnElInventario(page, serie)).toHaveCount(0);
    await expect(
      page.getByText("Sin activos que coincidan con los filtros"),
    ).toBeVisible();

    await cambiarAEmpresa(page, PRIMERA);
    await expect(await buscarEnElInventario(page, serie)).toHaveCount(1);
  });

  test("la elección sobrevive a abrir otra pantalla", async ({ page }) => {
    /* Si se perdiera, cada navegación devolvería al usuario a su empresa
       predeterminada sin avisar, y estaría leyendo cifras de la otra. */
    await page.goto("/admin/activos");
    await cambiarAEmpresa(page, SEGUNDA);

    await page.goto("/admin/dashboard");

    await expect(page.getByLabel("Empresa")).toHaveValue(String(SEGUNDA.id));
    await expect(page.getByText("Activos registrados")).toBeVisible();
  });

  test("los catálogos también son los de la empresa elegida", async ({
    page,
  }) => {
    /* No solo el inventario: las áreas, las sedes y los tipos son de cada
       empresa. Un desplegable que se quedara con los de la otra dejaría
       registrar un equipo contra un área que no existe aquí. */
    await page.goto("/admin/organizacion/departamentos");
    const enLaPrimera = await textoDeLaTabla(page);

    await cambiarAEmpresa(page, SEGUNDA);

    expect(await textoDeLaTabla(page)).not.toEqual(enLaPrimera);
  });
});

// --- Apoyos -----------------------------------------------------------------

/**
 * Cambia de empresa y espera a que la aplicación termine de recargarse.
 *
 * El cambio dispara una recarga entera —no un refresco de la pantalla actual—,
 * así que navegar sin esperarla aborta la carga en curso.
 */
async function cambiarAEmpresa(page, empresa) {
  const selector = page.getByLabel("Empresa");
  await expect(selector).toBeVisible();
  await Promise.all([
    page.waitForEvent("load"),
    selector.selectOption(String(empresa.id)),
  ]);
  await expect(page.getByLabel("Empresa")).toHaveValue(String(empresa.id));
}

/** Lo que dice la tabla de la pantalla, como texto. */
async function textoDeLaTabla(page) {
  await page.waitForLoadState("networkidle");
  return page.locator("table tbody").innerText();
}
