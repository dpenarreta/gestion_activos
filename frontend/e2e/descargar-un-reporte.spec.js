import { expect, test } from "@playwright/test";

/*
 * Generar un reporte y bajárselo.
 *
 * Es lo que ninguna otra capa puede comprobar. La descarga no es una respuesta
 * JSON: el archivo se pide por axios —porque una navegación directa del
 * navegador no llevaría la cabecera de sesión, y poner el token en la URL lo
 * dejaría en el historial y en los logs del servidor—, llega como blob y el
 * propio navegador lo materializa. Entre esas tres piezas hay sitio de sobra
 * para que un cambio inocente produzca un archivo vacío, un 401 silencioso o
 * un nombre sin extensión, y nada de eso sale en una prueba de componentes.
 */

test.describe("Reportes", () => {
  test("el catálogo se dibuja con lo que declara el backend", async ({
    page,
  }) => {
    /* La pantalla no conoce ningún reporte: los pinta desde el catálogo. Un
       reporte nuevo aparece aquí sin tocar el frontend, y esta prueba es la
       que dice que ese contrato sigue en pie. */
    await page.goto("/admin/reportes");

    await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
    await expect(enElCatalogo(page, "Inventario general")).toBeVisible();
    await expect(
      enElCatalogo(page, "Valor en libros y depreciación"),
    ).toBeVisible();
  });

  test("la vista previa muestra filas antes de descargar nada", async ({
    page,
  }) => {
    /* Revisar antes de bajar: un archivo de 2.000 filas que resulta no ser el
       que se quería cuesta más de lo que parece. */
    await page.goto("/admin/reportes");
    await enElCatalogo(page, "Inventario general").click();

    await expect(page.locator("table thead")).toBeVisible();
    await expect(page.locator("table tbody tr").first()).toBeVisible();
  });

  test("el Excel se descarga con su nombre y con contenido", async ({
    page,
  }) => {
    await page.goto("/admin/reportes");
    await enElCatalogo(page, "Inventario general").click();
    await expect(page.locator("table tbody tr").first()).toBeVisible();

    const [descarga] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Excel/ }).click(),
    ]);

    expect(descarga.suggestedFilename()).toMatch(
      /^inventario-general.*\.xlsx$/,
    );
    // Un archivo de cero bytes se abre y no dice nada: es el fallo silencioso
    // que esta prueba existe para atrapar.
    const ruta = await descarga.path();
    const { size } = await import("node:fs").then((fs) => fs.statSync(ruta));
    expect(size).toBeGreaterThan(1000);
  });

  test("el reporte de valor en libros también sale en PDF", async ({
    page,
  }) => {
    /* El más nuevo y el que más piezas cruza: resuelve la política de
       depreciación de cada tipo antes de escribir la primera fila. */
    await page.goto("/admin/reportes");
    await enElCatalogo(page, "Valor en libros y depreciación").click();
    await expect(page.locator("table thead")).toBeVisible();

    const [descarga] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /PDF/ }).click(),
    ]);

    expect(descarga.suggestedFilename()).toMatch(/\.pdf$/);
    const ruta = await descarga.path();
    const { size } = await import("node:fs").then((fs) => fs.statSync(ruta));
    expect(size).toBeGreaterThan(1000);
  });
});

/**
 * El reporte en la lista de la izquierda.
 *
 * Su nombre sale dos veces en la pantalla —en el catálogo y como título del
 * que está abierto—, así que se pide por el botón que lo selecciona.
 */
function enElCatalogo(page, nombre) {
  return page.getByRole("button", { name: new RegExp(`^${nombre}`) });
}
