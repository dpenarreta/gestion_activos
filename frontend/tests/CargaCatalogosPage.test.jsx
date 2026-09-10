import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Carga masiva de catálogos: un archivo por catálogo.
 *
 * Lo delicado no es subir el archivo sino lo que pasa entre subirlo y
 * guardarlo: se revisa completo, se dice qué entraría y nada se escribe hasta
 * que alguien lo confirme. Si esa revisión dejara de bloquear, un archivo con
 * cincuenta filas mal escritas entraría a medias y nadie sabría cuáles.
 */

const listarCatalogos = vi.fn();
const plantilla = vi.fn();
const validar = vi.fn();
const importar = vi.fn();

vi.mock("../src/api/catalogosService", () => ({
  catalogosMasivosService: {
    listar: (...args) => listarCatalogos(...args),
    plantilla: (...args) => plantilla(...args),
    validar: (...args) => validar(...args),
    importar: (...args) => importar(...args),
  },
}));

const descargar = vi.fn();
vi.mock("../src/utils/descargas", () => ({
  descargarBlob: (...args) => descargar(...args),
}));

const { CargaCatalogosPage } =
  await import("../src/pages/Admin/CargaCatalogos/CargaCatalogosPage");

const CATALOGOS = {
  catalogos: [
    {
      clave: "empleados",
      nombre: "Empleados",
      plural: "empleados",
      nota: "El área debe existir.",
      puede: true,
    },
    {
      clave: "proveedores",
      nombre: "Proveedores",
      plural: "proveedores",
      nota: "",
      puede: true,
    },
    // Sin permiso para cargarlo: no debe aparecer.
    { clave: "sedes", nombre: "Sedes", plural: "sedes", puede: false },
  ],
};

const REPORTE_LIMPIO = {
  total_filas: 3,
  filas_validas: 3,
  filas_con_error: 0,
  es_importable: true,
  errores: [],
  advertencias: [],
  columnas: ["Cédula", "Nombre"],
  vista_previa: [
    { fila: 2, valores: ["1712345678", "Ana Cevallos"] },
    { fila: 3, valores: ["1798765432", "Luis Mora"] },
  ],
};

function archivoXlsx(nombre = "empleados.xlsx") {
  return new File(["contenido"], nombre, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function pintar() {
  return render(
    <MemoryRouter>
      <CargaCatalogosPage />
    </MemoryRouter>,
  );
}

/** Sube un archivo al panel visible y espera a que termine la revisión. */
async function subir(archivo = archivoXlsx()) {
  const campo = screen.getByLabelText(/^Archivo de /);
  fireEvent.change(campo, { target: { files: [archivo] } });
  await waitFor(() => expect(validar).toHaveBeenCalled());
  return campo;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarCatalogos.mockResolvedValue(CATALOGOS);
  plantilla.mockResolvedValue(new Blob(["x"]));
  validar.mockResolvedValue(REPORTE_LIMPIO);
  importar.mockResolvedValue({ creados: 3, advertencias: [] });
});

// --- Qué catálogos se ofrecen -----------------------------------------------

describe("La lista de catálogos", () => {
  it("la trae el backend: uno nuevo aparece sin tocar el frontend", async () => {
    pintar();

    expect(
      await screen.findByRole("tab", { name: "Empleados" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Proveedores" }),
    ).toBeInTheDocument();
  });

  it("no ofrece los que el usuario no puede cargar", async () => {
    /* Ofrecer una pestaña que termina en un 403 al importar hace perder el
       trabajo de llenar el archivo. */
    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    expect(
      screen.queryByRole("tab", { name: "Sedes" }),
    ).not.toBeInTheDocument();
  });

  it("abre con el primero elegido, no con la pantalla en blanco", async () => {
    pintar();

    expect(
      await screen.findByRole("tab", { name: "Empleados" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText("Descargue el archivo de empleados"),
    ).toBeInTheDocument();
  });

  it("cambiar de catálogo descarta lo revisado del anterior", async () => {
    /* El reporte pertenece al archivo de empleados; dejarlo en pantalla con
       «Proveedores» seleccionado invitaría a importarlo en el catálogo
       equivocado. */
    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();
    await screen.findByText(/Revisión de empleados.xlsx/);

    fireEvent.click(screen.getByRole("tab", { name: "Proveedores" }));

    expect(screen.queryByText(/Revisión de/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Descargue el archivo de proveedores"),
    ).toBeInTheDocument();
  });

  it("si la lista no carga, lo dice", async () => {
    listarCatalogos.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByText("No se pudo cargar la lista de catálogos."),
    ).toBeInTheDocument();
  });
});

// --- La plantilla -----------------------------------------------------------

describe("La plantilla", () => {
  it("se descarga con el nombre del catálogo elegido", async () => {
    pintar();

    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar plantilla/ }),
    );

    await waitFor(() => expect(plantilla).toHaveBeenCalledWith("empleados"));
    expect(descargar).toHaveBeenCalledWith(
      expect.any(Blob),
      "plantilla-empleados.xlsx",
    );
  });

  it("dice lo que hace falta saber de ese catálogo en particular", async () => {
    pintar();

    expect(await screen.findByText(/El área debe existir/)).toBeInTheDocument();
  });

  it("si no se puede descargar, lo dice en vez de no hacer nada", async () => {
    plantilla.mockRejectedValue(new Error("500"));

    pintar();

    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar plantilla/ }),
    );

    expect(
      await screen.findByText("No se pudo descargar la plantilla."),
    ).toBeInTheDocument();
  });
});

// --- La revisión previa -----------------------------------------------------

describe("Antes de guardar nada, se revisa", () => {
  it("subir el archivo lo revisa solo: no hay un botón de «revisar»", async () => {
    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();

    expect(validar).toHaveBeenCalledWith("empleados", expect.any(File));
  });

  it("muestra cuántas filas entrarían y una vista previa", async () => {
    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();

    expect(
      await screen.findByText("Revisión de empleados.xlsx"),
    ).toBeInTheDocument();
    expect(screen.getByText("Se crearán").previousSibling).toHaveTextContent(
      "3",
    );
    expect(screen.getByText("Ana Cevallos")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Importar 3 empleados" }),
    ).toBeEnabled();
  });

  it("con errores no deja importar, y los agrupa por fila", async () => {
    /* Se corrige fila por fila en el archivo; una lista plana de veinte
       mensajes obliga a reconstruir a mano qué le pasa a cada una. */
    validar.mockResolvedValue({
      ...REPORTE_LIMPIO,
      filas_validas: 1,
      filas_con_error: 2,
      es_importable: false,
      vista_previa: [],
      errores: [
        { fila: 4, columna: "Cédula", mensaje: "No es una cédula válida." },
        { fila: 4, columna: "Nombre", mensaje: "Obligatorio." },
        { fila: 7, columna: "Área", mensaje: "No existe «Contabilida»." },
      ],
    });

    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();

    expect(
      await screen.findByText(/No se importará nada mientras haya errores/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Corrija 2 fila(s) para importar" }),
    ).toBeDisabled();

    const fila4 = screen.getByText("Fila 4").closest("li");
    expect(fila4).toHaveTextContent("No es una cédula válida.");
    expect(fila4).toHaveTextContent("Obligatorio.");
  });

  it("con errores tampoco se muestra la vista previa: no hay nada que entre", async () => {
    validar.mockResolvedValue({
      ...REPORTE_LIMPIO,
      es_importable: false,
      filas_con_error: 1,
      errores: [{ fila: 4, columna: "Cédula", mensaje: "Inválida." }],
    });

    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();

    await screen.findByText(/No se importará nada/);
    expect(screen.queryByText("Ana Cevallos")).not.toBeInTheDocument();
  });

  it("las filas repetidas se avisan pero no bloquean", async () => {
    /* Volver a subir el mismo archivo con diez filas nuevas al final es el uso
       normal: lo que ya existe se omite y el resto entra. */
    validar.mockResolvedValue({
      ...REPORTE_LIMPIO,
      advertencias: [{ fila: 2, columna: "Cédula", mensaje: "Ya registrada." }],
    });

    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();

    expect(
      await screen.findByText(/Estas filas ya existen/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Importar 3 empleados" }),
    ).toBeEnabled();
  });

  it("si la revisión falla, lo dice y no deja un reporte a medias", async () => {
    validar.mockRejectedValue(new Error("500"));

    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();

    expect(
      await screen.findByText("No se pudo revisar el archivo."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Revisión de/)).not.toBeInTheDocument();
  });
});

// --- La importación ---------------------------------------------------------

describe("Al confirmar la importación", () => {
  it("envía el mismo archivo que se revisó y dice cuántos se crearon", async () => {
    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();

    fireEvent.click(
      await screen.findByRole("button", { name: "Importar 3 empleados" }),
    );

    await waitFor(() =>
      expect(importar).toHaveBeenCalledWith("empleados", expect.any(File)),
    );
    expect(await screen.findByText(/Se crearon/)).toHaveTextContent(
      "Se crearon 3 empleados.",
    );
  });

  it("dice cuántas se omitieron por existir ya", async () => {
    importar.mockResolvedValue({
      creados: 2,
      advertencias: [{ fila: 2, columna: "Cédula", mensaje: "Ya registrada." }],
    });

    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();
    fireEvent.click(await screen.findByRole("button", { name: /^Importar/ }));

    expect(
      await screen.findByText(/1 fila\(s\) ya existían y se omitieron/),
    ).toBeInTheDocument();
  });

  it("importado, el reporte desaparece: no se puede importar dos veces", async () => {
    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();
    fireEvent.click(await screen.findByRole("button", { name: /^Importar/ }));

    await screen.findByText(/Se crearon/);
    expect(
      screen.queryByRole("button", { name: /^Importar/ }),
    ).not.toBeInTheDocument();
  });

  it("si la importación falla, lo dice y el reporte sigue ahí para reintentar", async () => {
    importar.mockRejectedValue(new Error("500"));

    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();
    fireEvent.click(await screen.findByRole("button", { name: /^Importar/ }));

    expect(
      await screen.findByText("No se pudo importar el archivo."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Importar 3 empleados" }),
    ).toBeEnabled();
  });

  it("«elegir otro archivo» deja el panel como estaba", async () => {
    pintar();

    await screen.findByRole("tab", { name: "Empleados" });
    await subir();

    fireEvent.click(
      await screen.findByRole("button", { name: "Elegir otro archivo" }),
    );

    expect(screen.queryByText(/Revisión de/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Archivo de /)).toHaveValue("");
  });
});
