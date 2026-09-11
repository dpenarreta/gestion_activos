import { expect } from "@playwright/test";

/**
 * Gestos que más de una prueba necesita hacer sobre la interfaz.
 *
 * Viven aquí y no repetidos en cada archivo porque son justamente lo que se
 * rompe al cambiar una pantalla: si el alta de un activo gana un campo
 * obligatorio, hay un solo sitio que corregir.
 */

/**
 * Elige la primera opción real de un desplegable.
 *
 * Los catálogos los llena el backend y sus identificadores cambian de una base
 * a otra, así que fijar un valor concreto ataría las pruebas a la máquina donde
 * se escribieron. La primera opción es siempre el marcador de posición
 * («Seleccione…»), y por eso se descarta.
 */
export async function elegirPrimeraOpcion(ambito, etiqueta) {
  const select = ambito.getByLabel(etiqueta);
  const opciones = select.locator("option");

  // Los catálogos llegan por su propia petición, después de que la pantalla se
  // dibuja: leer las opciones sin esperar encuentra solo el marcador.
  await expect
    .poll(async () => opciones.count(), {
      message: `el desplegable «${etiqueta}» no llegó a cargarse`,
    })
    .toBeGreaterThan(1);

  const valores = await opciones.evaluateAll((lista) =>
    lista.map((o) => o.value).filter(Boolean),
  );
  await select.selectOption(valores[0]);
}

/**
 * Registra un equipo en la empresa activa y deja abierta su ficha.
 *
 * Se llena lo mínimo que el formulario exige; lo demás lo prueban las de
 * componentes, que no necesitan un navegador para hacerlo.
 */
export async function registrarEquipo(
  page,
  { nombre, serie, costo, condicion, concesionario, compartido },
) {
  await page.goto("/admin/activos/new");
  await elegirPrimeraOpcion(page, "Tipo de dispositivo");
  await page.getByLabel("Nombre del activo").fill(nombre);
  await page.getByLabel("Marca").fill("Dell");
  await page.getByLabel("Modelo").fill("Latitude 5440");
  await page.getByLabel("Número de serie").fill(serie);
  await elegirPrimeraOpcion(page, "Departamento");
  await page.getByLabel("Fecha de adquisición").fill("2025-03-01");
  if (compartido) {
    // La marca decide qué clase de equipo es; el alta entrega igual a una sola
    // persona, y al resto del turno se lo suma después desde la ficha. Se le
    // pone una para que haya de dónde partir.
    await page.getByLabel("Varias personas responden por él").check();
    await elegirPrimeraOpcion(page, "Custodio");
  }
  if (costo) {
    await page.getByLabel("Costo de compra").fill(costo);
  }
  if (condicion) {
    await page.getByLabel("Condición al adquirirlo").selectOption(condicion);
  }
  if (concesionario) {
    // El desplegable del partner solo existe una vez marcado el equipo como
    // ajeno: es la mitad de lo que hay que comprobar.
    await page.getByLabel("De quién es el equipo").selectOption("concesion");
    await page
      .getByLabel("Concesionario")
      .selectOption({ label: concesionario });
  }

  await page.getByRole("button", { name: "Registrar activo" }).click();
  await noHayError(page, "El alta del equipo fue rechazada");

  // El alta lleva a la ficha del equipo recién creado: es donde está el código
  // de barras, que es lo único que no venía en el formulario.
  await expect(page.getByRole("heading", { name: nombre })).toBeVisible();
  return page.locator("code.codigo-barras").first().innerText();
}

/**
 * Busca en el inventario y devuelve las filas que coinciden.
 *
 * La espera se ata a la respuesta de la propia búsqueda y no a que la red se
 * calme: «calmada» también está la red mientras la pantalla todavía muestra el
 * listado anterior, y entonces una prueba que cuenta filas mide lo de antes.
 */
export async function buscarEnElInventario(page, texto) {
  await page.goto("/admin/activos");
  await page.getByLabel("Buscar activos").fill(texto);

  await Promise.all([
    page.waitForResponse(
      (respuesta) =>
        respuesta.url().includes(`q=${encodeURIComponent(texto)}`) &&
        respuesta.status() === 200,
    ),
    page.getByRole("button", { name: "Buscar" }).last().click(),
  ]);

  // Y a que la tabla haya vuelto a dibujarse con lo que llegó: o hay filas, o
  // está el renglón que explica que no hay ninguna.
  await expect(
    page.locator("tbody tr").filter({ hasText: /./ }).first(),
  ).toBeVisible();

  return page.locator("tbody tr", { hasText: texto });
}

/**
 * Falla con lo que la pantalla dice, si es que dice algo.
 *
 * Sin esto, un formulario rechazado se manifiesta como «no aparece el título»
 * y hay que abrir la traza para enterarse del motivo, que estaba escrito en
 * pantalla todo el tiempo.
 */
export async function noHayError(page, contexto) {
  const aviso = page.locator(".alert-danger");
  if (await aviso.count()) {
    throw new Error(`${contexto}: ${await aviso.first().innerText()}`);
  }
}
