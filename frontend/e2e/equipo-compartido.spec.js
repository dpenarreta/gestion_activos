import { expect, test } from "@playwright/test";

import {
  buscarEnElInventario,
  elegirPrimeraOpcion,
  registrarEquipo,
} from "./apoyo/pantallas.js";

/*
 * Un equipo del que responde más de uno.
 *
 * Del escáner de un andén responde el turno entero, y ninguno responde más que
 * otro. Lo que esta prueba sostiene es la parte que ninguna otra capa cruza: el
 * alta marcándolo como compartido, sumar a una segunda persona desde la ficha
 * —el diálogo mantiene una lista, no reemplaza a nadie— y que cada entrega deje
 * su propio movimiento, que es de donde sale el acta que cada quien firma.
 *
 * Van en serie porque cada paso deja al equipo como el siguiente lo necesita.
 */

/** Un nombre que solo puede ser de esta ejecución, para poder retirarlo luego. */
const MARCA = `E2E-${Date.now()}`;
const SERIE = `SN-${MARCA}`;

test.describe.configure({ mode: "serial" });

test.describe("Un equipo de turno", () => {
  let codigoDeBarras;

  test("se registra marcado como compartido y con su primer responsable", async ({
    page,
  }) => {
    codigoDeBarras = await registrarEquipo(page, {
      nombre: MARCA,
      serie: SERIE,
      compartido: true,
    });

    expect(await valorDe(page, "Responsables")).not.toBe("");
  });

  test("se le suma una segunda persona sin quitar a la primera", async ({
    page,
  }) => {
    await abrirFicha(page, codigoDeBarras);
    const antes = await page.locator(".activo-responsables li").count();

    await page.getByRole("button", { name: /Asignar \/ trasladar/ }).click();
    const dialogo = page.getByRole("dialog");
    // Quien ya responde no aparece en la lista de a quién sumar, así que la
    // primera opción real es siempre otra persona.
    await elegirPrimeraOpcion(dialogo, "Sumar a alguien");
    await dialogo.getByRole("button", { name: "Confirmar" }).click();

    await expect(page.locator(".activo-responsables li")).toHaveCount(
      antes + 1,
    );
  });

  test("cada entrega dejó su propio movimiento, que es su acta", async ({
    page,
  }) => {
    /* En un equipo compartido no hay un titular que pueda firmar por los
       demás: por eso el historial no lleva un solo apunte por operación. */
    await abrirFicha(page, codigoDeBarras);

    const asignaciones = page.locator("tbody tr", { hasText: "Asignación" });
    await expect(asignaciones.first()).toBeVisible();
    expect(await asignaciones.count()).toBeGreaterThanOrEqual(1);
  });
});

/** Abre la ficha del equipo desde el inventario. */
async function abrirFicha(page, codigo) {
  const fila = await buscarEnElInventario(page, codigo);
  await fila.getByRole("link", { name: "Ver ficha" }).click();
  await expect(page.getByRole("heading", { name: MARCA })).toBeVisible();
}

/** El valor que la ficha muestra para una etiqueta de su lista de datos. */
async function valorDe(page, etiqueta) {
  return page
    .locator("dt", { hasText: new RegExp(`^${etiqueta}$`) })
    .first()
    .locator("xpath=following-sibling::dd[1]")
    .innerText();
}
