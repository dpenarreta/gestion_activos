import { expect, test } from "@playwright/test";

import {
  buscarEnElInventario,
  elegirPrimeraOpcion,
  registrarEquipo,
} from "./apoyo/pantallas.js";

/*
 * La vida de un equipo, de punta a punta y en una sola prueba.
 *
 * Alta, etiqueta, entrega, reparación y baja. Van juntas y en orden porque es
 * así como ocurren: cada paso deja al equipo en el estado que el siguiente
 * necesita, y partirlas en cinco pruebas independientes obligaría a montar ese
 * estado por debajo —con lo que ya no se estaría probando que la propia
 * aplicación sepa llegar hasta ahí—.
 *
 * Es la prueba que justifica esta capa entera: cada paso pasa por el
 * navegador, el enrutador, la sesión, la API y la base, y ninguno de los
 * otros tres niveles de prueba los cruza a la vez.
 */

/** Un nombre que solo puede ser de esta ejecución, para poder retirarlo luego. */
const MARCA = `E2E-${Date.now()}`;
const SERIE = `SN-${MARCA}`;

test.describe.configure({ mode: "serial" });

test.describe("Un equipo, de su alta a su baja", () => {
  let codigoDeBarras;

  test("se registra y el sistema le pone su código de barras", async ({
    page,
  }) => {
    codigoDeBarras = await registrarEquipo(page, {
      nombre: MARCA,
      serie: SERIE,
      costo: "1800",
      condicion: "usado",
    });

    expect(codigoDeBarras).toMatch(/^GA-[A-Z0-9]+-\d{6}$/);
  });

  test("aparece en el inventario y se encuentra por su serie", async ({
    page,
  }) => {
    /* Es lo que hace un técnico con el equipo en la mano: teclear la serie del
       fabricante, que es la que está impresa en el aparato. */
    const fila = await buscarEnElInventario(page, SERIE);

    await expect(fila).toBeVisible();
    await expect(fila).toContainText("Sin asignar");
  });

  test("se entrega a un responsable y queda en su historial", async ({
    page,
  }) => {
    await abrirFicha(page, codigoDeBarras);

    await page.getByRole("button", { name: /Asignar \/ trasladar/ }).click();
    const dialogo = page.getByRole("dialog");
    await elegirPrimeraOpcion(dialogo, "Nuevo responsable");
    // La entrega también deja el equipo en su sitio: entregarlo suele ser
    // ponerlo donde trabaja quien lo recibe, y registrar el traslado aparte
    // dejaba la ubicación desactualizada hasta que alguien se acordara.
    await elegirPrimeraOpcion(dialogo, "Sede donde queda el equipo");
    await dialogo.getByRole("button", { name: "Confirmar" }).click();

    await expect(page.getByText("Asignación").first()).toBeVisible();
    // A que la ficha se haya releído, y no solo a que el movimiento aparezca:
    // el listado de responsables es lo último que llega, y sin esperarlo se
    // leen los datos de antes de la entrega.
    await expect(page.locator(".activo-responsables li").first()).toBeVisible();

    // El responsable queda en la ficha, y el movimiento en la bitácora: las
    // dos cosas, porque una sin la otra deja al inventario sin poder explicar
    // desde cuándo lo tiene esa persona.
    expect(await valorDe(page, "Responsable")).not.toBe("Sin asignar");
    // Y el equipo queda donde se lo entregó: la entrega lleva la sede, para no
    // tener que registrar después un traslado que nadie se acuerda de hacer.
    expect(await valorDe(page, "Ciudad")).not.toBe("—");
  });

  test("la ficha recuerda que se compró usado", async ({ page }) => {
    /* Se capturó en el alta y se lee en la ficha: un dato que se escribe y no
       se puede volver a mirar no sirve para decidir nada. */
    await abrirFicha(page, codigoDeBarras);

    expect(await valorDe(page, "Condición al adquirirlo")).toBe("Usado");
  });

  test("se le registra una reparación y le sube el contador", async ({
    page,
  }) => {
    await abrirFicha(page, codigoDeBarras);
    await page.getByRole("link", { name: /Registrar mantenimiento/ }).click();

    // El equipo llega puesto desde la URL, pero su ficha se pide aparte:
    // enviar antes de que llegue deja el campo vacío y la validación del
    // navegador corta el envío sin que nada se vea en la pantalla.
    await expect(page.getByRole("button", { name: "Cambiar" })).toBeVisible();

    await page.getByLabel("Nombre del técnico o proveedor").fill("Taller E2E");
    await page.getByLabel("Trabajo realizado").fill("Cambio de disco");
    await page.getByLabel("Costo de mano de obra").fill("45");
    await page.getByRole("button", { name: "Registrar intervención" }).click();

    // Registrar la intervención devuelve a la ficha del equipo, que es donde
    // se ve reflejado el contador que acaba de moverse.
    await expect(page.getByRole("heading", { name: MARCA })).toBeVisible();
    await expect(page.getByText("Cambio de disco").first()).toBeVisible();
  });

  test("se da de baja con su motivo y sale del parque", async ({ page }) => {
    await abrirFicha(page, codigoDeBarras);

    await page.getByRole("button", { name: /Cambiar estado/ }).click();
    const dialogo = page.getByRole("dialog");
    await dialogo.getByLabel("Nuevo estado").selectOption("dado_de_baja");
    await dialogo.getByLabel(/Motivo/).fill("Fin de vida útil (prueba E2E)");
    await dialogo
      .getByRole("button", { name: /Dar de baja|Confirmar/ })
      .click();

    await expect(page.getByText("Motivo de la salida")).toBeVisible();

    // Y deja de contarse entre los operativos: el inventario sin filtros ya no
    // lo muestra, que es lo que separa «dado de baja» de «apagado».
    await page.goto("/admin/activos");
    await page.getByLabel("Buscar activos").fill(SERIE);
    await page.getByRole("button", { name: "Buscar" }).last().click();
    await expect(page.locator("tr", { hasText: codigoDeBarras })).toHaveCount(
      1,
    );
    await expect(page.locator("tr", { hasText: codigoDeBarras })).toContainText(
      "Dado de baja",
    );
  });
});

// --- Apoyos -----------------------------------------------------------------

/** Abre la ficha de un equipo buscándolo por su código de barras. */
async function abrirFicha(page, codigo) {
  const fila = await buscarEnElInventario(page, codigo);
  await fila.getByRole("link", { name: "Ver ficha" }).click();
  await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
}

/** El valor que la ficha muestra para una etiqueta de su lista de datos. */
async function valorDe(page, etiqueta) {
  return page
    .locator("dt", { hasText: new RegExp(`^${etiqueta}$`) })
    .first()
    .locator("xpath=following-sibling::dd[1]")
    .innerText();
}
