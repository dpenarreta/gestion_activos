import { expect, test } from "@playwright/test";

import {
  buscarEnElInventario,
  noHayError,
  registrarEquipo,
} from "./apoyo/pantallas.js";

/*
 * Un equipo que no compró la empresa.
 *
 * Dar de alta al partner y luego registrarle un equipo son dos pantallas
 * distintas que solo sirven juntas: el catálogo existe para que el alta pueda
 * elegir de él, y el alta existe para que el catálogo diga algo. Probarlas
 * sueltas dejaría fuera justo lo que las une.
 *
 * Lo que se comprueba al final es la ficha, porque es donde la distinción se
 * lee: «En concesión» y de quién es, al lado del proveedor, que responde a
 * otra pregunta.
 */

/** Un nombre que solo puede ser de esta ejecución, para poder retirarlo luego. */
const MARCA = `E2E-${Date.now()}`;
const PARTNER = `${MARCA} Logística`;
const SERIE = `SN-${MARCA}`;

test.describe.configure({ mode: "serial" });

test.describe("Un equipo puesto por un partner", () => {
  test("el partner se registra en su catálogo", async ({ page }) => {
    await page.goto("/admin/organizacion/concesionarios/new");
    await page.getByLabel("Nombre").fill(PARTNER);
    await page.getByLabel("Teléfono").fill("0988888888");
    await page.getByRole("button", { name: "Guardar" }).click();
    await noHayError(page, "El alta del concesionario fue rechazada");

    await expect(
      page.getByRole("heading", { name: "Concesionarios" }),
    ).toBeVisible();
    await expect(page.getByText(PARTNER)).toBeVisible();
  });

  test("el equipo se registra a su nombre y la ficha lo dice", async ({
    page,
  }) => {
    await registrarEquipo(page, {
      nombre: MARCA,
      serie: SERIE,
      costo: "1800",
      concesionario: PARTNER,
    });

    expect(await valorDe(page, "Propiedad")).toBe("En concesión");
    expect(await valorDe(page, "Concesionario")).toBe(PARTNER);
  });

  test("no se le calcula valor en libros: la compra fue del partner", async ({
    page,
  }) => {
    /* Contarlo abultaría el valor del parque con algo que es de otro. El costo
       sí se guarda —es lo que el partner puso— y se sigue viendo. */
    const fila = await buscarEnElInventario(page, SERIE);
    await fila.getByRole("link", { name: "Ver ficha" }).click();

    await expect(page.getByRole("heading", { name: MARCA })).toBeVisible();
    expect(await valorDe(page, "Costo de compra")).toContain("1.800");
    await expect(
      page.locator("dt", { hasText: "Valor en libros" }),
    ).toHaveCount(0);
  });

  test("el inventario responde qué hay que devolverle", async ({ page }) => {
    /* Es la pregunta que se hace al cerrar una concesión, y la que separa lo
       que sí es patrimonio de la empresa. */
    await page.goto("/admin/activos?propiedad=concesion");

    const fila = page.locator("tbody tr", { hasText: MARCA });
    await expect(fila.first()).toBeVisible();
    await expect(page.getByLabel("Filtrar por propiedad")).toHaveValue(
      "concesion",
    );
  });
});

/**
 * El valor que la ficha muestra para una etiqueta de su lista de datos.
 *
 * La ficha repite varios textos por la pantalla, así que se busca el término
 * exacto y se lee su definición, que es como la lee una persona.
 */
async function valorDe(page, etiqueta) {
  return page
    .locator("dt", { hasText: new RegExp(`^${etiqueta}$`) })
    .first()
    .locator("xpath=following-sibling::dd[1]")
    .innerText();
}
