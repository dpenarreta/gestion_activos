import { expect, test } from "@playwright/test";

/*
 * Entrar al sistema y llegar a lo que uno vino a ver.
 *
 * Es el recorrido que sostiene a los demás: si la sesión no viaja entre
 * pantallas, ninguna otra prueba de este directorio significa nada. Y es de las
 * pocas cosas que no se pueden comprobar por debajo —un token inyectado a mano
 * demuestra que la API responde, no que alguien pueda entrar—.
 */

test.describe("El panel principal", () => {
  test("se llega al panel con la sesión abierta", async ({ page }) => {
    await page.goto("/admin/dashboard");

    await expect(
      page.getByRole("heading", { name: "Panel principal" }),
    ).toBeVisible();
    await expect(page.getByText("Activos registrados")).toBeVisible();
  });

  test("los indicadores llevan al inventario ya filtrado", async ({ page }) => {
    /* Un número que no lleva a los equipos que lo componen obliga a
       reconstruir el filtro a mano. Aquí se comprueba de punta a punta: el
       enlace, la ruta y que el listado de verdad se acote. */
    await page.goto("/admin/dashboard");

    await page.getByText("Dados de baja").click();

    await expect(page).toHaveURL(/\/admin\/activos\?estado=dado_de_baja/);
    await expect(
      page.getByRole("heading", { name: "Inventario de activos" }),
    ).toBeVisible();
    await expect(page.getByLabel("Filtrar por estado")).toHaveValue(
      "dado_de_baja",
    );
  });

  test("el menú lleva a cada sección y la sesión aguanta el recorrido", async ({
    page,
  }) => {
    /* Es lo que una prueba de componentes no puede decir: que la sesión siga
       viva al cuarto salto y que ninguna pantalla se quede en blanco por un
       401 que nadie miró. */
    await page.goto("/admin/dashboard");

    for (const [grupo, opcion, titulo] of [
      [null, "Alertas", "Alertas del parque"],
      ["Activos", "Inventario", "Inventario de activos"],
      ["Mantenimientos", "Bitácora", "Bitácora de mantenimientos"],
      [null, "Reportes", "Reportes"],
    ]) {
      if (grupo) {
        await page.getByRole("button", { name: new RegExp(grupo) }).click();
      }
      await page.getByRole("link", { name: opcion, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: titulo, level: 2 }),
      ).toBeVisible();
    }
  });
});

test.describe("La sesión", () => {
  test("sin sesión, el panel manda al login", async ({ browser }) => {
    /* La única prueba que arranca con el navegador limpio: el resto hereda la
       sesión guardada. */
    const contexto = await browser.newContext({ storageState: undefined });
    const pagina = await contexto.newPage();

    await pagina.goto("/admin/dashboard");

    await expect(pagina).toHaveURL(/\/login/);
    await expect(pagina.getByLabel("Usuario o correo")).toBeVisible();
    await contexto.close();
  });

  test("una contraseña equivocada no dice si la cuenta existe", async ({
    browser,
  }) => {
    /* La regla que se pierde al «mejorar» un mensaje de error: dos respuestas
       distintas convertirían el login en un detector de cuentas válidas. */
    const contexto = await browser.newContext({ storageState: undefined });
    const pagina = await contexto.newPage();

    await pagina.goto("/login");
    await pagina.getByLabel("Usuario o correo").fill("e2e_bot");
    await pagina.getByLabel("Contraseña").fill("no-es-la-clave");
    await pagina.getByRole("button", { name: "Entrar" }).click();

    const aviso = pagina.locator(".alert-danger");
    await expect(aviso).toBeVisible();
    const conCuenta = await aviso.textContent();

    // El identificador inexistente lleva el mismo prefijo que la cuenta de
    // pruebas: el contador de intentos fallidos se cuenta por texto tecleado, y
    // la preparación limpia justamente los que empiezan por `e2e_`.
    await pagina.getByLabel("Usuario o correo").fill("e2e_no_existe");
    await pagina.getByRole("button", { name: "Entrar" }).click();
    await expect(aviso).toHaveText(conCuenta);

    await contexto.close();
  });
});
