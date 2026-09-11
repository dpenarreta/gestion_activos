import { expect, test } from "@playwright/test";

import { registrarEquipo } from "./apoyo/pantallas.js";

/*
 * La consulta de campo: el técnico con el equipo delante.
 *
 * Dispara la pistola sobre la etiqueta y, con lo que sale, hace una de dos
 * cosas: mirar la ficha o anotar la avería. Que las dos estén ahí mismo es el
 * punto de la pantalla; entrar a la ficha para buscar dentro el botón de
 * registrar es un rodeo justo cuando se tiene el aparato en la mano.
 *
 * Se prueba de extremo a extremo porque el recorrido cruza tres pantallas y un
 * parámetro en la URL: escáner, formulario de mantenimiento y ficha.
 */

test.describe.configure({ mode: "serial" });

test.describe("Consulta por escáner", () => {
  const SERIE = `SN-E2E-${Date.now()}`;
  let codigo;

  test.beforeAll(async ({ browser }) => {
    const pagina = await browser.newPage();
    codigo = await registrarEquipo(pagina, {
      nombre: `E2E-${SERIE}`,
      serie: SERIE,
    });
    await pagina.close();
  });

  test("una lectura devuelve el equipo y sus dos acciones", async ({
    page,
  }) => {
    await page.goto("/admin/activos/escaner");

    await escanear(page, codigo);

    await expect(
      page.getByRole("heading", { name: `E2E-${SERIE}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Ver ficha completa/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Registrar mantenimiento/ }),
    ).toBeVisible();
  });

  test("también se lee por el número de serie del fabricante", async ({
    page,
  }) => {
    /* Es lo que está impreso en el aparato cuando la etiqueta propia se
       despegó o todavía no se puso. */
    await page.goto("/admin/activos/escaner");

    await escanear(page, SERIE);

    await expect(
      page.getByRole("heading", { name: `E2E-${SERIE}` }),
    ).toBeVisible();
  });

  test("desde la lectura se llega al mantenimiento con el equipo ya puesto", async ({
    page,
  }) => {
    /* El parámetro de la URL es lo que evita volver a buscar el equipo en un
       desplegable de trescientos, con el equipo delante. */
    await page.goto("/admin/activos/escaner");
    await escanear(page, codigo);

    await page.getByRole("link", { name: /Registrar mantenimiento/ }).click();

    await expect(
      page.getByRole("heading", { name: "Registrar mantenimiento" }),
    ).toBeVisible();
    await expect(page.getByLabel("Activo intervenido")).toHaveValue(
      new RegExp("^\\d+$"),
    );
    const elegido = await page
      .getByLabel("Activo intervenido")
      .locator("option:checked")
      .innerText();
    expect(elegido).toContain(codigo);
  });

  test("un código que no existe lo dice y no deja la lectura anterior", async ({
    page,
  }) => {
    /* Sería el peor error posible aquí: leer los datos del equipo anterior
       creyendo que son los del que se tiene en la mano. */
    await page.goto("/admin/activos/escaner");
    await escanear(page, codigo);
    await expect(
      page.getByRole("heading", { name: `E2E-${SERIE}` }),
    ).toBeVisible();

    await escanear(page, "GA-XXX-999999");

    await expect(page.getByText(/Ningún activo corresponde a/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `E2E-${SERIE}` }),
    ).toHaveCount(0);
  });
});

/** Dispara una lectura, como hace la pistola: teclear y cerrar con Enter. */
async function escanear(page, texto) {
  const campo = page.getByLabel("Código de barras o número de serie");
  await campo.fill(texto);
  await campo.press("Enter");
}
