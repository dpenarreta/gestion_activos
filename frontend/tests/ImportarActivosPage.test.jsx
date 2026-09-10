import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Carga masiva de activos.
 *
 * El flujo es de dos pasos a propósito: al elegir el archivo se valida y se
 * muestra qué entraría, y solo entonces se puede confirmar. Lo que se prueba
 * aquí es que ese freno sea real —con errores no entra nada, porque un
 * inventario a medio cargar es peor que uno vacío: no se sabe qué entró— y que
 * los avisos, que no bloquean, se distingan de los errores, que sí.
 */

const descargarPlantilla = vi.fn();
const enviar = vi.fn();

vi.mock("../src/api/activosService", () => ({
  importacionActivosService: {
    descargarPlantilla: (...args) => descargarPlantilla(...args),
    enviar: (...args) => enviar(...args),
  },
}));

const { ImportarActivosPage } =
  await import("../src/pages/Admin/Activos/ImportarActivosPage");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");

const LIMPIO = {
  total_filas: 2,
  filas_validas: 2,
  filas_con_error: 0,
  es_importable: true,
  errores: [],
  advertencias: [],
  vista_previa: [
    {
      fila: 2,
      nombre: "Laptop Contabilidad 01",
      marca: "HP",
      modelo: "ProBook 450",
      numero_serie: "HP450-0033",
      tipo: "Laptop",
      departamento: "Contabilidad",
      custodio: "Ana Cevallos",
    },
    {
      fila: 3,
      nombre: "Impresora Bodega",
      marca: "HP",
      modelo: "M404",
      numero_serie: "HP404-0044",
      tipo: "Impresora",
      departamento: "Logística",
      custodio: "",
    },
  ],
};

function archivo(nombre = "activos.xlsx") {
  return new File(["contenido"], nombre, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Deja ver a dónde navega la pantalla al terminar. */
function Destino() {
  return <p>Destino: {useLocation().pathname}</p>;
}

function pintar() {
  return render(
    <MemoryRouter initialEntries={["/admin/activos/importar"]}>
      {/* Las pestañas de la pantalla piden confirmación antes de salir con
          cambios sin guardar, y ese contexto lo monta el layout de /admin. */}
      <UnsavedChangesProvider>
        <Routes>
          <Route
            path="/admin/activos/importar"
            element={<ImportarActivosPage />}
          />
          <Route path="*" element={<Destino />} />
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

/** Sube un archivo y espera a que termine la revisión. */
async function subir(fichero = archivo()) {
  fireEvent.change(screen.getByLabelText("Archivo de carga masiva"), {
    target: { files: [fichero] },
  });
  await waitFor(() => expect(enviar).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  descargarPlantilla.mockResolvedValue(new Blob(["x"]));
  enviar.mockResolvedValue(LIMPIO);
  // jsdom no implementa la creación de URLs de objeto.
  URL.createObjectURL = vi.fn(() => "blob:plantilla");
  URL.revokeObjectURL = vi.fn();
});

// --- Los pasos --------------------------------------------------------------

describe("La pantalla explica el flujo antes de pedir el archivo", () => {
  it("dice que el código de barras no se llena", async () => {
    /* Es la primera columna que alguien intenta rellenar a mano, y la única
       que el sistema genera. */
    pintar();

    expect(await screen.findByText(/El código de barras/)).toHaveTextContent(
      "no se llena",
    );
  });

  it("dice que nada se guarda hasta confirmar", async () => {
    pintar();

    expect(
      await screen.findByText(/Nada se guarda hasta que confirme/),
    ).toBeInTheDocument();
  });

  it("la plantilla se descarga con su nombre", async () => {
    pintar();

    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar plantilla/ }),
    );

    await waitFor(() => expect(descargarPlantilla).toHaveBeenCalled());
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("si la plantilla no se puede bajar, lo dice", async () => {
    descargarPlantilla.mockRejectedValue(new Error("500"));

    pintar();

    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar plantilla/ }),
    );

    expect(
      await screen.findByText("No se pudo descargar la plantilla."),
    ).toBeInTheDocument();
  });
});

// --- La revisión ------------------------------------------------------------

describe("Al subir el archivo se revisa entero", () => {
  it("se valida sin confirmar: el archivo viaja sin la orden de guardar", async () => {
    pintar();
    await subir();

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][1]).toBeUndefined();
  });

  it("muestra qué entraría, con una vista previa", async () => {
    pintar();
    await subir();

    expect(
      await screen.findByText("Revisión de activos.xlsx"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Listas para importar").previousSibling,
    ).toHaveTextContent("2");
    expect(screen.getByText("Laptop Contabilidad 01")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Importar 2 activo(s)" }),
    ).toBeEnabled();
  });

  it("un equipo sin custodio se lee «Bodega», no una celda vacía", async () => {
    pintar();
    await subir();

    const fila = (await screen.findByText("Impresora Bodega")).closest("tr");
    expect(fila).toHaveTextContent("Bodega");
  });

  it("con errores no se importa nada, y el botón dice la verdad", async () => {
    /* «Importar 2 activos» prometería algo que el botón no hace, aunque esté
       deshabilitado. */
    enviar.mockResolvedValue({
      ...LIMPIO,
      filas_validas: 1,
      filas_con_error: 2,
      es_importable: false,
      vista_previa: [],
      errores: [
        { fila: 4, columna: "Serie", mensaje: "Ya existe en el inventario." },
        { fila: 4, columna: "Tipo", mensaje: "No existe «Laptp»." },
        { fila: 9, columna: "Área", mensaje: "Obligatoria." },
      ],
    });

    pintar();
    await subir();

    expect(
      await screen.findByText(/No se importará nada mientras haya errores/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Corrija 2 fila(s) para importar" }),
    ).toBeDisabled();
  });

  it("los errores se agrupan por fila, que es como se corrige el archivo", async () => {
    /* Una lista plana repite el número de fila en cada línea: con tres errores
       en la fila 4 se lee tres veces «4» y no queda claro si son tres filas o
       una. */
    enviar.mockResolvedValue({
      ...LIMPIO,
      es_importable: false,
      filas_con_error: 1,
      vista_previa: [],
      errores: [
        { fila: 4, columna: "Serie", mensaje: "Ya existe en el inventario." },
        { fila: 4, columna: "Tipo", mensaje: "No existe «Laptp»." },
      ],
    });

    pintar();
    await subir();

    const fila = (await screen.findByText("Fila 4")).closest("li");
    expect(fila).toHaveTextContent("Ya existe en el inventario.");
    expect(fila).toHaveTextContent("No existe «Laptp».");
    expect(screen.getAllByText(/^Fila /)).toHaveLength(1);
  });

  it("los avisos no bloquean y se separan de los errores", async () => {
    /* Mezclarlos obligaría a elegir entre frenar cargas legítimas o callar
       cosas que conviene mirar antes de confirmar. */
    enviar.mockResolvedValue({
      ...LIMPIO,
      advertencias: [
        { fila: 3, columna: "Costo", mensaje: "Sin costo de compra." },
      ],
    });

    pintar();
    await subir();

    expect(
      await screen.findByText(/Esto se importará igual/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Importar 2 activo(s)" }),
    ).toBeEnabled();
  });

  it("si el archivo no se puede leer, lo dice y no queda a medias", async () => {
    enviar.mockRejectedValue({
      response: { data: { error: { message: "El archivo no es un .xlsx." } } },
    });

    pintar();
    await subir();

    expect(
      await screen.findByText("El archivo no es un .xlsx."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Revisión de/)).not.toBeInTheDocument();
  });

  it("«elegir otro archivo» deja la pantalla como estaba", async () => {
    pintar();
    await subir();

    fireEvent.click(
      await screen.findByRole("button", { name: "Elegir otro archivo" }),
    );

    expect(screen.queryByText(/Revisión de/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Archivo de carga masiva")).toHaveValue("");
  });
});

// --- La importación ---------------------------------------------------------

describe("Al confirmar", () => {
  it("se manda el mismo archivo, ahora sí con la orden de guardar", async () => {
    enviar.mockResolvedValueOnce(LIMPIO).mockResolvedValueOnce({ creados: [] });

    pintar();
    await subir();

    fireEvent.click(
      await screen.findByRole("button", { name: "Importar 2 activo(s)" }),
    );

    await waitFor(() => expect(enviar).toHaveBeenCalledTimes(2));
    expect(enviar.mock.calls[1][1]).toEqual({ confirmar: true });
  });

  it("lista los códigos de barras que acaban de nacer, con enlace a cada ficha", async () => {
    /* Es lo que hace falta para ir a imprimir las etiquetas, y lo único que no
       estaba en el archivo que se subió. */
    enviar.mockResolvedValueOnce(LIMPIO).mockResolvedValueOnce({
      creados: [
        {
          id: 51,
          codigo_barras: "GA-LAP-000051",
          nombre: "Laptop Contabilidad 01",
        },
        { id: 52, codigo_barras: "GA-IMP-000052", nombre: "Impresora Bodega" },
      ],
    });

    pintar();
    await subir();
    fireEvent.click(
      await screen.findByRole("button", { name: "Importar 2 activo(s)" }),
    );

    expect(
      await screen.findByText(/Se importaron 2 activo\(s\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("GA-LAP-000051").closest("a")).toHaveAttribute(
      "href",
      "/admin/activos/51",
    );
  });

  it("importado, el reporte desaparece: no se importa dos veces el mismo archivo", async () => {
    enviar.mockResolvedValueOnce(LIMPIO).mockResolvedValueOnce({ creados: [] });

    pintar();
    await subir();
    fireEvent.click(
      await screen.findByRole("button", { name: "Importar 2 activo(s)" }),
    );

    await screen.findByText(/Se importaron 0 activo\(s\)/);
    expect(
      screen.queryByRole("button", { name: /^Importar/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Archivo de carga masiva")).toHaveValue("");
  });

  it("desde el resultado se va al inventario", async () => {
    enviar.mockResolvedValueOnce(LIMPIO).mockResolvedValueOnce({ creados: [] });

    pintar();
    await subir();
    fireEvent.click(
      await screen.findByRole("button", { name: "Importar 2 activo(s)" }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Ver el inventario" }),
    );

    expect(
      await screen.findByText("Destino: /admin/activos"),
    ).toBeInTheDocument();
  });

  it("si la importación falla, lo dice y el reporte sigue para reintentar", async () => {
    enviar
      .mockResolvedValueOnce(LIMPIO)
      .mockRejectedValueOnce(new Error("500"));

    pintar();
    await subir();
    fireEvent.click(
      await screen.findByRole("button", { name: "Importar 2 activo(s)" }),
    );

    expect(
      await screen.findByText("No se pudo completar la importación."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Importar 2 activo(s)" }),
    ).toBeEnabled();
  });
});
