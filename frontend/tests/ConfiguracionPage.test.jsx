import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Configuración: identidad, colores y apariencia.
 *
 * Las dos primeras pestañas editan el mismo tema del sitio y comparten un solo
 * guardado; la tercera es una preferencia del dispositivo y se aplica sola. Lo
 * que se prueba es el freno que impide guardar un tema roto —un hexadecimal
 * mal escrito dejaría media interfaz sin color— y la advertencia de contraste,
 * que no bloquea pero avisa antes y después de guardar: un texto que nadie
 * puede leer es un fallo que solo se nota cuando ya está en producción.
 */

const obtenerTema = vi.fn();
const obtenerOpciones = vi.fn();
const actualizarTema = vi.fn();
const restaurarTema = vi.fn();

vi.mock("../src/api/themeService", () => ({
  themeService: {
    getAdmin: (...args) => obtenerTema(...args),
    getOptions: (...args) => obtenerOpciones(...args),
    update: (...args) => actualizarTema(...args),
    reset: (...args) => restaurarTema(...args),
  },
}));

const { ConfiguracionPage } =
  await import("../src/pages/Admin/Configuracion/ConfiguracionPage");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");
const { AppearanceProvider } = await import("../src/context/AppearanceContext");

const TEMA = {
  site_name: "Gestión de Activos",
  short_name: "GA",
  logo_url: "https://ejemplo.test/logo.png",
  favicon_url: "",
  color_primary: "#0D6EFD",
  color_secondary: "#6C757D",
  color_background: "#FFFFFF",
  color_headings: "#212529",
  color_text: "#212529",
  color_links: "#0D6EFD",
  color_buttons: "#0D6EFD",
  color_menu: "#212529",
  font_primary: "inter",
  font_secondary: "inter",
  font_size_base: 16,
  border_radius: "md",
};

const OPCIONES = {
  fonts: [
    { key: "inter", label: "Inter", css_stack: "Inter, sans-serif" },
    { key: "lora", label: "Lora", css_stack: "Lora, serif" },
  ],
  border_radii: {
    sm: { value: "0.25rem", label: "Pequeño" },
    md: { value: "0.5rem", label: "Medio" },
  },
};

function pintar(ruta = "/admin/configuracion/identidad") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      {/* Los dos contextos que en la aplicación monta el layout de /admin. */}
      <AppearanceProvider>
        <UnsavedChangesProvider>
          <Routes>
            <Route
              path="/admin/configuracion/:seccion"
              element={<ConfiguracionPage />}
            />
          </Routes>
        </UnsavedChangesProvider>
      </AppearanceProvider>
    </MemoryRouter>,
  );
}

/**
 * El campo de texto de un color.
 *
 * Los ocho comparten placeholder y ninguno tiene etiqueta propia —la etiqueta
 * cuelga del selector de paleta—, así que se llega a él desde ahí.
 */
function campoDeColor(etiqueta) {
  return screen
    .getByLabelText(`Paleta de color para ${etiqueta}`)
    .closest(".colores-tab__color-field")
    .querySelector('input[type="text"]');
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  obtenerTema.mockResolvedValue(TEMA);
  obtenerOpciones.mockResolvedValue(OPCIONES);
  actualizarTema.mockResolvedValue({ ...TEMA, warnings: [] });
  restaurarTema.mockResolvedValue(TEMA);
  // jsdom no trae `matchMedia`, del que depende la apariencia «del sistema».
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

// --- Identidad --------------------------------------------------------------

describe("La pestaña de identidad", () => {
  it("carga lo configurado", async () => {
    pintar();

    expect(await screen.findByLabelText("Nombre del sitio")).toHaveValue(
      "Gestión de Activos",
    );
    expect(screen.getByLabelText("Nombre corto")).toHaveValue("GA");
  });

  it("muestra en vivo cómo se verá, antes de guardar", async () => {
    /* El nombre y el logo se ven en la pestaña del navegador y en el menú:
       verlos recién después de guardar obligaría a probar a ciegas. */
    pintar();

    await screen.findByLabelText("Nombre del sitio");
    fireEvent.change(screen.getByLabelText("Nombre del sitio"), {
      target: { value: "Inventario Laar" },
    });

    expect(screen.getByText("Inventario Laar")).toBeInTheDocument();
  });

  it("sin nombre configurado la vista previa no queda vacía", async () => {
    obtenerTema.mockResolvedValue({ ...TEMA, site_name: "" });

    pintar();

    // La etiqueta del campo también dice «Nombre del sitio»: se mira la de la
    // vista previa, que es la que quedaría en blanco.
    expect(
      await screen.findByText("Nombre del sitio", {
        selector: ".identidad-tab__preview-tab-label",
      }),
    ).toBeInTheDocument();
  });

  it("guarda el número del tamaño de fuente como número, no como texto", async () => {
    /* Viene del formulario como cadena; el backend espera un entero. */
    pintar();

    await screen.findByLabelText("Nombre del sitio");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(actualizarTema).toHaveBeenCalled());
    expect(actualizarTema.mock.calls[0][0].font_size_base).toBe(16);
  });

  it("si el servidor rechaza el tema, lo dice con su motivo", async () => {
    actualizarTema.mockRejectedValue({
      response: {
        data: { error: { message: "El logo no es una URL válida." } },
      },
    });

    pintar();

    await screen.findByLabelText("Nombre del sitio");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText("El logo no es una URL válida."),
    ).toBeInTheDocument();
  });
});

// --- Colores ----------------------------------------------------------------

describe("La pestaña de colores", () => {
  const RUTA = "/admin/configuracion/colores-tipografia";

  it("un hexadecimal mal escrito no se puede guardar", async () => {
    /* Guardarlo dejaría media interfaz sin ese color, y el fallo se
       descubriría navegando. */
    pintar(RUTA);

    await screen.findByText("Colores");
    fireEvent.change(campoDeColor("Color primario"), {
      target: { value: "azul" },
    });

    expect(
      screen.getByText("Formato hexadecimal inválido."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("corregido, vuelve a poder guardarse", async () => {
    pintar(RUTA);

    await screen.findByText("Colores");
    fireEvent.change(campoDeColor("Color primario"), {
      target: { value: "azul" },
    });
    fireEvent.change(campoDeColor("Color primario"), {
      target: { value: "#FF5733" },
    });

    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("avisa del contraste insuficiente mientras se elige el color", async () => {
    /* No bloquea —puede haber una decisión de marca detrás— pero un texto que
       nadie puede leer es un fallo que solo se nota en producción. */
    obtenerTema.mockResolvedValue({
      ...TEMA,
      color_text: "#EEEEEE",
      color_background: "#FFFFFF",
    });

    pintar(RUTA);

    expect(
      await screen.findByText(/Advertencia de accesibilidad/),
    ).toBeInTheDocument();
    // Y aun así se puede guardar: es un aviso, no un bloqueo.
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("con buen contraste no aparece la advertencia", async () => {
    pintar(RUTA);

    await screen.findByText("Colores");
    expect(
      screen.queryByText(/Advertencia de accesibilidad/),
    ).not.toBeInTheDocument();
  });

  it("las advertencias que devuelve el servidor se muestran tras guardar", async () => {
    actualizarTema.mockResolvedValue({
      ...TEMA,
      warnings: [{ pair: "texto sobre fondo" }],
    });

    pintar(RUTA);

    await screen.findByText("Colores");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      await screen.findByText(/La configuración se guardó/),
    ).toHaveTextContent("texto sobre fondo");
  });

  it("ofrece el catálogo de fuentes que trae el backend", async () => {
    pintar(RUTA);

    // Una para la fuente principal y otra para la secundaria.
    await screen.findByText("Colores");
    expect(screen.getAllByRole("option", { name: "Lora" })).toHaveLength(2);
  });
});

// --- Restaurar --------------------------------------------------------------

describe("Restaurar los valores por defecto", () => {
  it("pregunta antes, diciendo qué se pierde", async () => {
    pintar();

    await screen.findByLabelText("Nombre del sitio");
    fireEvent.click(
      screen.getByRole("button", { name: "Restaurar valores por defecto" }),
    );

    expect(
      await screen.findByText(/Se perderá toda la personalización visual/),
    ).toBeInTheDocument();
    expect(restaurarTema).not.toHaveBeenCalled();
  });

  it("cancelar no restaura nada", async () => {
    pintar();

    await screen.findByLabelText("Nombre del sitio");
    fireEvent.click(
      screen.getByRole("button", { name: "Restaurar valores por defecto" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    expect(restaurarTema).not.toHaveBeenCalled();
  });

  it("confirmado, el formulario vuelve a lo que devuelve el servidor", async () => {
    restaurarTema.mockResolvedValue({ ...TEMA, site_name: "Sistema" });

    pintar();

    await screen.findByLabelText("Nombre del sitio");
    fireEvent.click(
      screen.getByRole("button", { name: "Restaurar valores por defecto" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(restaurarTema).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre del sitio")).toHaveValue("Sistema"),
    );
  });
});

// --- Apariencia -------------------------------------------------------------

describe("La pestaña de apariencia", () => {
  const RUTA = "/admin/configuracion/apariencia";

  it("no tiene «Guardar»: es una preferencia del dispositivo", async () => {
    /* No es un dato del tema del sitio, así que no se comparte con nadie ni
       espera una confirmación. */
    pintar(RUTA);

    expect(
      await screen.findByText(/Apariencia del panel administrativo/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar" }),
    ).not.toBeInTheDocument();
  });

  it("elegir un modo se aplica de inmediato y se recuerda", async () => {
    pintar(RUTA);

    fireEvent.click(await screen.findByLabelText("Oscuro"));

    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark"),
    );
    expect(screen.getByLabelText("Oscuro")).toBeChecked();
  });

  it("«usar la del sistema» es una opción, no el silencio", async () => {
    pintar(RUTA);

    expect(
      await screen.findByLabelText("Usar configuración del sistema"),
    ).toBeInTheDocument();
  });
});
