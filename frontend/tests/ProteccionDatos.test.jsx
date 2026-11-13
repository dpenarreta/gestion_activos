import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * «Protección de datos» con pestañas (US-004, 11/11/2026): «Solicitudes»,
 * «Textos» y «Aceptaciones», cada una con su permiso (con solo
 * `privacidad.textos` se entra directo a «Textos»); el catálogo agrupado por
 * módulo y sección; la edición (validaciones junto al campo, versión, pedir
 * de nuevo, solo lectura) y el historial de versiones; las aceptaciones con
 * filtros, paginación, detalle con el texto exacto y Excel; y la explicación
 * de «Mis derechos» leída del catálogo. Los servicios van simulados; los
 * datos son ficticios.
 */

const servicio = {};
const permisos = { lista: [] };

function texto(extra = {}) {
  return {
    clave: "cumpleanos_publico",
    modulo: "Mi perfil",
    seccion: "Cumpleaños",
    nombre: "Cumpleaños público",
    descripcion: "Lo acepta quien muestra su cumpleaños en el calendario.",
    requiere_aceptacion: true,
    lleva_titulo: false,
    variables: [],
    pide_aceptar_de_nuevo_al_guardar: true,
    existe: true,
    titulo: "",
    texto:
      "Acepto que mi día de cumpleaños sea información pública dentro de la empresa.",
    version: 2,
    version_exigida: 2,
    editado_en: "2026-11-10T09:00:00-05:00",
    editado_por: { id: 3, nombre: "Adela Ibáñez" },
    ...extra,
  };
}

const AVISO = texto({
  clave: "aviso_privacidad",
  modulo: "General",
  seccion: "Entrada a la intranet",
  nombre: "Aviso de tratamiento de datos",
  descripcion: "Lo acepta cada persona al entrar a la intranet.",
  pide_aceptar_de_nuevo_al_guardar: false,
  texto: "Primer párrafo del aviso de tratamiento de datos.\n\n- Dato uno",
  version: 3,
  version_exigida: 2,
});
const DERECHOS = texto({
  clave: "derechos_explicacion",
  seccion: "Mis derechos",
  nombre: "Explicación de los derechos",
  requiere_aceptacion: false,
  pide_aceptar_de_nuevo_al_guardar: false,
  variables: ["plazo"],
  texto: "La empresa le responde en un plazo de {plazo} días desde su pedido.",
  editado_en: null,
  editado_por: null,
});
const ACUERDO = texto({
  clave: "acuerdo_confidencialidad",
  modulo: "Institucional › Códigos de conducta",
  seccion: "Leer documentos",
  nombre: "Acuerdo de confidencialidad",
  lleva_titulo: true,
  titulo: "Acuerdo de confidencialidad",
  texto: "Los documentos de esta sección son de uso interno de la empresa.",
});
const CUMPLE = texto();

function catalogo(puedeEditar = true) {
  return {
    puede_editar: puedeEditar,
    modulos: [
      {
        modulo: "General",
        secciones: [{ seccion: "Entrada a la intranet", textos: [AVISO] }],
      },
      {
        modulo: "Mi perfil",
        secciones: [
          { seccion: "Cumpleaños", textos: [CUMPLE] },
          { seccion: "Mis derechos", textos: [DERECHOS] },
        ],
      },
      {
        modulo: "Institucional › Códigos de conducta",
        secciones: [{ seccion: "Leer documentos", textos: [ACUERDO] }],
      },
    ],
  };
}

function aceptacion(extra = {}) {
  return {
    id: 11,
    persona: { id: 40, nombre: "Ana Pérez", usuario: "aperez" },
    clave: "cumpleanos_publico",
    nombre_texto: "Cumpleaños público",
    modulo: "Mi perfil",
    seccion: "Cumpleaños",
    version: 2,
    aceptado_en: "2026-11-10T11:00:00-05:00",
    ip: "10.0.0.8",
    navegador: "Firefox",
    origen: "perfil",
    origen_label: "Mi perfil",
    migrada: false,
    estado: "vigente",
    vigente: true,
    de_la_version_exigida: true,
    retirada_en: null,
    retirada_por: null,
    restablecida_en: null,
    restablecida_por: null,
    ...extra,
  };
}

const MIGRADA = aceptacion({
  id: 12,
  persona: { id: 41, nombre: "Íñigo Núñez", usuario: "inunez" },
  clave: "aniversario_publico",
  nombre_texto: "Aniversario público",
  seccion: "Aniversario",
  version: 1,
  ip: null,
  origen: "migrada",
  origen_label: "Migrada",
  migrada: true,
  estado: "retirada",
  vigente: false,
  retirada_en: "2026-11-01T08:00:00-05:00",
});

function reiniciar() {
  Object.keys(servicio).forEach((k) => delete servicio[k]);
  Object.assign(servicio, {
    textos: vi.fn().mockResolvedValue(catalogo()),
    guardarTexto: vi.fn(),
    versionesTexto: vi.fn().mockResolvedValue([
      {
        version: 2,
        titulo: "",
        texto: CUMPLE.texto,
        editado_en: "2026-11-10T09:00:00-05:00",
        editado_por: { id: 3, nombre: "Adela Ibáñez" },
        motivo: "Redacción más clara",
        vigente: true,
      },
      {
        version: 1,
        titulo: "",
        texto: "El texto inicial del cumpleaños público.",
        editado_en: "2026-11-01T09:00:00-05:00",
        editado_por: null,
        motivo: "Texto inicial del catálogo.",
        vigente: false,
      },
    ]),
    aceptaciones: vi.fn().mockResolvedValue({
      count: 2,
      next: null,
      previous: null,
      results: [aceptacion(), MIGRADA],
    }),
    aceptacion: vi.fn().mockResolvedValue({
      ...aceptacion(),
      titulo: "",
      texto: "Acepto exactamente este texto del cumpleaños.",
      texto_de_la_version: null,
    }),
    exportarAceptaciones: vi
      .fn()
      .mockResolvedValue("aceptaciones-proteccion-datos.xlsx"),
    textoVigente: vi.fn().mockRejectedValue(new Error("sin servidor")),
    aviso: vi.fn().mockResolvedValue({
      existe: true,
      texto: AVISO.texto,
      version: 3,
      version_desde: "2026-11-09T10:00:00-05:00",
      editado_por: "Adela Ibáñez",
      totales: { personas: 2, aceptaron: 1, pendientes: 1 },
      puede_atender: true,
    }),
    personasConsentimiento: vi.fn().mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 40,
          nombre: "Ana Pérez",
          usuario: "aperez",
          correo: "aperez@example.com",
          estado: "ACEPTADO",
          aceptacion_de_nexo: false,
          ultima_aceptacion: null,
        },
      ],
    }),
    restablecerConsentimiento: vi.fn().mockResolvedValue({ aceptaciones: [] }),
    restablecerTodos: vi.fn().mockResolvedValue({ restablecidas: 1 }),
    bandeja: vi.fn().mockResolvedValue({
      count: 0,
      next: null,
      previous: null,
      results: [],
      totales: { abiertas: 0, vencidas: 0 },
    }),
  });
}
reiniciar();

vi.mock("../src/api/privacidadService", async (importOriginal) => ({
  ...(await importOriginal()),
  privacidadService: servicio,
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, permissions: permisos.lista },
    isAuthenticated: true,
    isInitializing: false,
  }),
}));
const confirmar = vi.fn().mockResolvedValue(true);
vi.mock("../src/components/common/Confirmar/confirmar", () => ({
  confirmar: (...a) => confirmar(...a),
}));

const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");
const { ProteccionDatosInicio, ProteccionDatosMarco, descripcion } =
  await import("../src/pages/Privacidad/ProteccionDatos");
const { TextosPrivacidad, validarTexto } =
  await import("../src/pages/Privacidad/TextosPrivacidad");
const { AceptacionesPrivacidad } =
  await import("../src/pages/Privacidad/AceptacionesPrivacidad");
const { pestanasDeProteccion } =
  await import("../src/pages/Privacidad/privacidadComunes");

beforeEach(() => {
  reiniciar();
  confirmar.mockClear().mockResolvedValue(true);
  permisos.lista = ["privacidad.ver", "privacidad.textos"];
});

function pintar(ui, ruta = "/admin/privacidad/textos") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <UnsavedChangesProvider>
        <Routes>
          <Route path="/admin/privacidad" element={<ProteccionDatosInicio />} />
          <Route path="/admin/privacidad/*" element={ui} />
          <Route path="/403" element={<p>Sin permiso</p>} />
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

// --- Pestañas y permisos --------------------------------------------------------

describe("Pestañas de Protección de datos", () => {
  it("con privacidad.ver se ven las tres pestañas", () => {
    expect(
      pestanasDeProteccion(["privacidad.ver"]).map((p) => p.label),
    ).toEqual(["Solicitudes", "Textos", "Aceptaciones"]);
  });

  it("con solo privacidad.textos, solo «Textos»", () => {
    expect(
      pestanasDeProteccion(["privacidad.textos"]).map((p) => p.label),
    ).toEqual(["Textos"]);
    expect(pestanasDeProteccion(["activos.ver"])).toEqual([]);
  });

  it("el marco muestra las pestañas permitidas y marca la actual", () => {
    permisos.lista = ["privacidad.atender"];
    pintar(
      <ProteccionDatosMarco seccion="textos">
        <p>Contenido</p>
      </ProteccionDatosMarco>,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Protección de datos" }),
    ).toBeInTheDocument();
    const pestanas = screen.getAllByRole("tab");
    expect(pestanas.map((p) => p.textContent)).toEqual([
      "Solicitudes",
      "Textos",
      "Aceptaciones",
    ]);
    expect(screen.getByRole("tab", { name: "Textos" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Contenido");
  });

  it("la descripción dice solo lo que hay en las pestañas visibles", () => {
    expect(descripcion(pestanasDeProteccion(["privacidad.ver"]))).toBe(
      "Las solicitudes de derechos sobre datos personales (LOPDP), los textos que la intranet muestra sobre ellos y quién los aceptó.",
    );
    expect(descripcion(pestanasDeProteccion(["privacidad.textos"]))).toBe(
      "Los textos que la intranet muestra sobre los datos personales de las personas.",
    );
  });

  it("solo la pestaña activa apunta a su panel", () => {
    pintar(
      <ProteccionDatosMarco seccion="textos">
        <p>Contenido</p>
      </ProteccionDatosMarco>,
    );
    expect(screen.getByRole("tab", { name: "Textos" })).toHaveAttribute(
      "aria-controls",
      "admin-tabpanel-textos",
    );
    expect(
      screen.getByRole("tab", { name: "Solicitudes" }),
    ).not.toHaveAttribute("aria-controls");
  });

  it("con solo privacidad.textos no hay barra de pestañas", () => {
    permisos.lista = ["privacidad.textos"];
    pintar(
      <ProteccionDatosMarco seccion="textos">
        <p>Contenido</p>
      </ProteccionDatosMarco>,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("Contenido")).toBeInTheDocument();
  });

  it("/admin/privacidad lleva a «Textos» si es lo único que puede abrir", async () => {
    permisos.lista = ["privacidad.textos"];
    pintar(<TextosPrivacidad />, "/admin/privacidad");
    expect(
      await screen.findByRole("heading", {
        name: "Textos de protección de datos",
      }),
    ).toBeInTheDocument();
  });

  it("/admin/privacidad sin ningún permiso va al 403", () => {
    permisos.lista = ["activos.ver"];
    pintar(<p>Nada</p>, "/admin/privacidad");
    expect(screen.getByText("Sin permiso")).toBeInTheDocument();
  });
});

// --- Textos ---------------------------------------------------------------------

describe("Textos: catálogo agrupado", () => {
  it("agrupa por módulo y sección, con lo que dice cada texto", async () => {
    pintar(<TextosPrivacidad />);
    const general = await screen.findByRole("region", { name: "General" });
    expect(
      within(general).getByRole("heading", {
        level: 5,
        name: "Entrada a la intranet",
      }),
    ).toBeInTheDocument();
    const perfil = screen.getByRole("region", { name: "Mi perfil" });
    expect(
      within(perfil)
        .getAllByRole("heading", { level: 5 })
        .map((h) => h.textContent),
    ).toEqual(["Cumpleaños", "Mis derechos"]);
    // Cada sección es una región con su nombre.
    expect(
      within(perfil).getByRole("region", { name: "Mis derechos" }),
    ).toHaveTextContent("Explicación de los derechos");

    const aviso = screen
      .getByRole("heading", { name: "Aviso de tratamiento de datos" })
      .closest("li");
    expect(within(aviso).getByText(/Pide aceptación/)).toBeInTheDocument();
    // La vigente y la exigida, si no coinciden.
    expect(
      within(aviso).getByText("Versión 3 · se exige la 2"),
    ).toBeInTheDocument();
    // Qué quiere decir la versión exigida.
    expect(
      within(aviso).getByText(/Se pide aceptar desde la versión 2/),
    ).toHaveTextContent("quien aceptó la 2 o posterior no tiene que volver");
    expect(within(aviso).getByText(/por Adela Ibáñez/)).toBeInTheDocument();
    expect(within(aviso).getByText("Dato uno").closest("li")).not.toBeNull();

    const derechos = screen
      .getByRole("heading", { name: "Explicación de los derechos" })
      .closest("li");
    expect(within(derechos).getByText(/Solo se muestra/)).toBeInTheDocument();
    expect(within(derechos).getByText(/Sin ediciones/)).toBeInTheDocument();
    expect(within(derechos).getByText("{plazo}")).toBeInTheDocument();
    // Los nombres de los textos son h6, bajo la sección (h5) y el módulo (h4).
    expect(
      screen.getByRole("heading", { level: 6, name: "Cumpleaños público" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 4, name: "Mi perfil" }),
    ).toBeInTheDocument();
  });

  it("tiene un índice de módulos y un buscador por nombre", async () => {
    pintar(<TextosPrivacidad />);
    const indice = await screen.findByRole("navigation", {
      name: "Módulos del catálogo",
    });
    const enlace = within(indice).getByRole("link", { name: "Mi perfil" });
    expect(screen.getByRole("region", { name: "Mi perfil" })).toHaveAttribute(
      "id",
      enlace.getAttribute("href").slice(1),
    );
    fireEvent.change(screen.getByLabelText("Buscar un texto por su nombre"), {
      target: { value: "cumpleanos" },
    });
    // Sin tildes también encuentra; los demás módulos se ocultan.
    expect(
      screen.getByRole("heading", { name: "Cumpleaños público" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "General" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Buscar un texto por su nombre"), {
      target: { value: "nada que ver" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Limpiar la búsqueda" }),
    );
    expect(screen.getByRole("region", { name: "General" })).toBeInTheDocument();
  });

  it("los textos largos se resumen y se despliegan enteros", async () => {
    const largo = `${"Este es un párrafo largo del aviso. ".repeat(10)}

- Dato final`;
    servicio.textos.mockResolvedValue({
      puede_editar: true,
      modulos: [
        {
          modulo: "General",
          secciones: [
            {
              seccion: "Entrada a la intranet",
              textos: [{ ...AVISO, texto: largo }],
            },
          ],
        },
      ],
    });
    pintar(<TextosPrivacidad />);
    const resumen = await screen.findByText("Ver el texto completo", {
      exact: false,
    });
    expect(resumen.closest("summary")).not.toBeNull();
    // Está en el resumen y en el texto completo.
    expect(screen.getAllByText("Dato final")[0].closest("li")).not.toBeNull();
  });

  it("el texto vigente conserva saltos de línea y viñetas, y lleva rótulos", async () => {
    servicio.textos.mockResolvedValue({
      puede_editar: true,
      modulos: [
        {
          modulo: "General",
          secciones: [
            {
              seccion: "Entrada a la intranet",
              textos: [
                {
                  ...AVISO,
                  texto:
                    "Primera línea\nSegunda línea\n\n- Viñeta uno\n- Viñeta dos",
                },
              ],
            },
          ],
        },
      ],
    });
    pintar(<TextosPrivacidad />);
    const tarjeta = (
      await screen.findByRole("heading", {
        name: "Aviso de tratamiento de datos",
      })
    ).closest("li");
    expect(within(tarjeta).getByText("Texto que ve la persona")).toBeVisible();
    expect(within(tarjeta).getByText("Dónde se muestra")).toBeInTheDocument();
    expect(within(tarjeta).getByText("Última edición")).toBeInTheDocument();
    // Cada línea por separado (no unidas en una sola) y las viñetas en lista.
    const primera = within(tarjeta).getByText("Primera línea");
    const segunda = within(tarjeta).getByText("Segunda línea");
    expect(primera).not.toBe(segunda);
    expect(primera.closest("p")).toBe(segunda.closest("p"));
    expect(primera.closest("p").querySelectorAll("br")).toHaveLength(1);
    const items = within(tarjeta).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Viñeta uno",
      "Viñeta dos",
    ]);
    expect(tarjeta).not.toHaveTextContent("Segunda línea - Viñeta");
  });

  it("sin permiso de edición solo se consulta", async () => {
    servicio.textos.mockResolvedValue(catalogo(false));
    permisos.lista = ["privacidad.ver"];
    pintar(<TextosPrivacidad />);
    expect(
      await screen.findByText(/Solo puede consultarlos/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar/ })).toBeNull();
    // Las versiones y las aceptaciones sí se consultan.
    expect(
      screen.getAllByRole("button", { name: /^Versiones/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", {
        name: "Aceptaciones de «Cumpleaños público»",
      }),
    ).toHaveAttribute(
      "href",
      "/admin/privacidad/aceptaciones?clave=cumpleanos_publico",
    );
  });

  it("si el catálogo no carga, deja reintentar", async () => {
    servicio.textos
      .mockRejectedValueOnce({ response: { status: 500, data: {} } })
      .mockResolvedValueOnce(catalogo());
    pintar(<TextosPrivacidad />);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("heading", { name: "Cumpleaños público" }),
    ).toBeInTheDocument();
  });

  it("el aviso sin crear se ofrece para crear, con el texto propuesto", async () => {
    servicio.textos.mockResolvedValue({
      puede_editar: true,
      modulos: [
        {
          modulo: "General",
          secciones: [
            {
              seccion: "Entrada a la intranet",
              textos: [
                {
                  ...AVISO,
                  existe: false,
                  version: null,
                  version_exigida: null,
                  editado_en: null,
                  editado_por: null,
                },
              ],
            },
          ],
        },
      ],
    });
    pintar(<TextosPrivacidad />);
    expect(await screen.findByText("Sin crear")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Crear «Aviso de tratamiento de datos»",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Versiones/ })).toBeNull();
  });
});

async function abrirEditor(nombre) {
  pintar(<TextosPrivacidad />);
  fireEvent.click(
    await screen.findByRole("button", { name: `Editar «${nombre}»` }),
  );
  return screen.findByRole("dialog", { name: new RegExp(nombre) });
}

describe("Textos: edición", () => {
  it("valida junto al campo: largo mínimo, sin enviar", async () => {
    const ventana = await abrirEditor("Cumpleaños público");
    const campo = within(ventana).getByLabelText(/^Texto/);
    fireEvent.change(campo, { target: { value: "Muy corto" } });
    expect(
      within(ventana).getByText("9 de 6000 caracteres (mínimo 20)"),
    ).toBeInTheDocument();
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    const error = await within(ventana).findByText(/al menos 20 caracteres/);
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo.getAttribute("aria-describedby")).toContain(error.id);
    await waitFor(() => expect(campo).toHaveFocus());
    expect(servicio.guardarTexto).not.toHaveBeenCalled();
  });

  it("exige conservar las variables y el título donde lo lleva", () => {
    expect(
      validarTexto(DERECHOS, {
        texto: "La empresa le responde en pocos días hábiles.",
        titulo: "",
        motivo: "",
      }).texto,
    ).toMatch(/\{plazo\}/);
    expect(
      validarTexto(ACUERDO, { texto: ACUERDO.texto, titulo: " ", motivo: "" })
        .titulo,
    ).toBe("Escriba el título.");
    expect(
      validarTexto(CUMPLE, {
        texto: "x".repeat(6001),
        titulo: "",
        motivo: "",
      }).texto,
    ).toMatch(/6000/);
    expect(
      validarTexto(CUMPLE, {
        texto: CUMPLE.texto,
        titulo: "",
        motivo: "m".repeat(301),
      }).motivo,
    ).toMatch(/300/);
  });

  it("guarda con motivo; si el texto cambió, anuncia la versión nueva", async () => {
    servicio.guardarTexto.mockResolvedValue({
      ...CUMPLE,
      texto: "Acepto que mi cumpleaños se vea en el calendario de Inicio.",
      version: 3,
      version_exigida: 3,
    });
    const ventana = await abrirEditor("Cumpleaños público");
    // Este texto pide aceptar la versión nueva según su pantalla: no hay
    // casilla de «Pedir aceptarlo de nuevo».
    expect(within(ventana).queryByRole("checkbox")).toBeNull();
    expect(
      within(ventana).getByText(/la versión 3 es la que se pide aceptar/),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText(/se guardará como versión 3/),
    ).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText(/^Texto/), {
      target: {
        value: "Acepto que mi cumpleaños se vea en el calendario de Inicio.",
      },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Motivo del cambio/), {
      target: { value: "Más claro" },
    });
    // La vista previa muestra lo escrito.
    fireEvent.click(within(ventana).getByText("Vista previa"));
    expect(
      within(ventana).getAllByText(
        "Acepto que mi cumpleaños se vea en el calendario de Inicio.",
      ).length,
    ).toBeGreaterThan(0);
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.guardarTexto).toHaveBeenCalledWith("cumpleanos_publico", {
        texto: "Acepto que mi cumpleaños se vea en el calendario de Inicio.",
        titulo: undefined,
        motivo: "Más claro",
        pedirDeNuevo: false,
      }),
    );
    const anuncio = await screen.findByText(
      "«Cumpleaños público» guardado como versión 3.",
    );
    expect(anuncio.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Versión 3")).toBeInTheDocument();
  });

  it("los textos de una línea se editan como una línea", async () => {
    const ventana = await abrirEditor("Cumpleaños público");
    expect(
      within(ventana).getByText(/Se muestra en una sola línea/),
    ).toBeInTheDocument();
    expect(within(ventana).queryByText(/forman una lista/)).toBeNull();
    expect(within(ventana).getByLabelText(/^Texto/)).toHaveAttribute(
      "rows",
      "3",
    );
  });

  it("«Pedir aceptarlo de nuevo» dice qué versión quedará exigida", async () => {
    const ventana = await abrirEditor("Aviso de tratamiento de datos");
    // El servidor siempre abre una versión nueva al pedirlo de nuevo, aunque
    // el texto no cambie: la siguiente a la vigente (3).
    expect(
      within(ventana).getByRole("checkbox", {
        name: /quedará exigida la versión 4/,
      }),
    ).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText(/^Texto/), {
      target: {
        value: "Un aviso distinto, con bastante más de veinte letras.",
      },
    });
    expect(
      within(ventana).getByRole("checkbox", {
        name: /quedará exigida la versión 4/,
      }),
    ).toBeInTheDocument();
  });

  it("mientras guarda, la ventana queda bloqueada", async () => {
    servicio.guardarTexto.mockReturnValue(new Promise(() => {}));
    const ventana = await abrirEditor("Cumpleaños público");
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    expect(
      await within(ventana).findByRole("button", { name: "Guardando…" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(within(ventana).getByLabelText(/^Texto/)).toHaveAttribute(
      "readonly",
    );
    expect(
      within(ventana).getByRole("button", { name: "Cancelar" }),
    ).toBeDisabled();
  });

  it("el error del servidor sale junto a su campo", async () => {
    servicio.guardarTexto.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: "validation_error",
            message: "Revise los datos.",
            details: { texto: ["El texto debe conservar {plazo}."] },
          },
        },
      },
    });
    const ventana = await abrirEditor("Cumpleaños público");
    fireEvent.change(within(ventana).getByLabelText(/^Texto/), {
      target: { value: "Un texto distinto y suficientemente largo." },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    const error = await within(ventana).findByText(
      "El texto debe conservar {plazo}.",
    );
    expect(within(ventana).getByLabelText(/^Texto/)).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining(error.id),
    );
  });

  it("el acuerdo lleva título obligatorio y se envía", async () => {
    servicio.guardarTexto.mockResolvedValue({ ...ACUERDO, titulo: "Reserva" });
    const ventana = await abrirEditor("Acuerdo de confidencialidad");
    const titulo = within(ventana).getByLabelText(/^Título/);
    fireEvent.change(titulo, { target: { value: "" } });
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    expect(
      await within(ventana).findByText("Escriba el título."),
    ).toBeInTheDocument();
    fireEvent.change(titulo, { target: { value: "Reserva" } });
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.guardarTexto).toHaveBeenCalledWith(
        "acuerdo_confidencialidad",
        expect.objectContaining({ titulo: "Reserva" }),
      ),
    );
  });

  it("el aviso general ofrece «Pedir aceptarlo de nuevo» y lo confirma", async () => {
    servicio.guardarTexto.mockResolvedValue({
      ...AVISO,
      version: 4,
      version_exigida: 4,
    });
    const ventana = await abrirEditor("Aviso de tratamiento de datos");
    fireEvent.click(
      within(ventana).getByRole("checkbox", {
        name: /Pedir aceptarlo de nuevo/,
      }),
    );
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(confirmar).toHaveBeenCalled());
    expect(servicio.guardarTexto).toHaveBeenCalledWith(
      "aviso_privacidad",
      expect.objectContaining({ pedirDeNuevo: true }),
    );
    expect(
      await screen.findByText(/versión 4: todas las personas lo aceptarán/),
    ).toBeInTheDocument();
  });

  it("si no confirma pedirlo de nuevo, no guarda", async () => {
    confirmar.mockResolvedValue(false);
    const ventana = await abrirEditor("Aviso de tratamiento de datos");
    fireEvent.click(
      within(ventana).getByRole("checkbox", {
        name: /Pedir aceptarlo de nuevo/,
      }),
    );
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(confirmar).toHaveBeenCalled());
    expect(servicio.guardarTexto).not.toHaveBeenCalled();
  });

  it("sin cambios en el texto, dice que la versión sigue igual", async () => {
    servicio.guardarTexto.mockResolvedValue(CUMPLE);
    const ventana = await abrirEditor("Cumpleaños público");
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    expect(
      await screen.findByText(/sigue en la versión 2/),
    ).toBeInTheDocument();
  });

  it("con cambios, cerrar pregunta antes de descartar", async () => {
    confirmar.mockResolvedValue(false);
    const ventana = await abrirEditor("Cumpleaños público");
    fireEvent.change(within(ventana).getByLabelText(/^Texto/), {
      target: { value: "Otro texto bastante más largo que veinte." },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(confirmar).toHaveBeenCalledWith(
        expect.objectContaining({ titulo: "¿Descartar los cambios?" }),
      ),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Textos: historial de versiones", () => {
  it("lista cada versión con quién, cuándo, el motivo y el texto", async () => {
    pintar(<TextosPrivacidad />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Versiones de «Cumpleaños público»",
      }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: /Versiones: Cumpleaños público/,
    });
    expect(servicio.versionesTexto).toHaveBeenCalledWith("cumpleanos_publico");
    const lista = await within(ventana).findByRole("list", {
      name: "Versiones, de la más nueva",
    });
    const items = within(lista).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Versión 2");
    expect(items[0]).toHaveTextContent("Vigente");
    expect(items[0]).toHaveTextContent("Adela Ibáñez");
    expect(items[0]).toHaveTextContent("Motivo: Redacción más clara");
    expect(items[1]).toHaveTextContent(
      "El texto inicial del cumpleaños público.",
    );
  });

  it("si no cargan, deja reintentar", async () => {
    servicio.versionesTexto.mockRejectedValueOnce({
      response: { status: 500, data: {} },
    });
    pintar(<TextosPrivacidad />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Versiones de «Cumpleaños público»",
      }),
    );
    const ventana = await screen.findByRole("dialog");
    fireEvent.click(
      await within(ventana).findByRole("button", { name: "Reintentar" }),
    );
    expect(
      await within(ventana).findByText("Motivo: Redacción más clara", {
        exact: false,
      }),
    ).toBeInTheDocument();
  });
});

// --- Aceptaciones ---------------------------------------------------------------

function pintarAceptaciones(ruta = "/admin/privacidad/aceptaciones") {
  return pintar(<AceptacionesPrivacidad />, ruta);
}

describe("Aceptaciones", () => {
  it("lista persona, texto, versión, fecha, IP, origen y estado", async () => {
    pintarAceptaciones();
    const fila = (await screen.findByText("Ana Pérez")).closest("tr");
    expect(within(fila).getByText("Cumpleaños público")).toBeInTheDocument();
    expect(
      within(fila).getByText("Mi perfil › Cumpleaños"),
    ).toBeInTheDocument();
    expect(within(fila).getByText("10.0.0.8")).toBeInTheDocument();
    expect(within(fila).getByText("Vigente")).toBeInTheDocument();

    const migrada = screen.getByText("Íñigo Núñez").closest("tr");
    expect(within(migrada).getByText("Retirada")).toBeInTheDocument();
    expect(within(migrada).getAllByText(/Migrada/).length).toBeGreaterThan(0);
    expect(within(migrada).getByText("—")).toBeInTheDocument();
  });

  it("filtra por módulo, sección, texto y estado (y lo pide al servidor)", async () => {
    pintarAceptaciones();
    await screen.findByText("Ana Pérez");
    const modulo = screen.getByLabelText("Módulo");
    await waitFor(() => expect(modulo).toBeEnabled());
    fireEvent.change(modulo, { target: { value: "Mi perfil" } });
    await waitFor(() =>
      expect(servicio.aceptaciones).toHaveBeenLastCalledWith(
        expect.objectContaining({ modulo: "Mi perfil", page: 1 }),
      ),
    );
    // Las secciones son las del módulo elegido.
    const seccion = screen.getByLabelText("Sección");
    expect(
      within(seccion)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Todas", "Cumpleaños", "Mis derechos"]);
    fireEvent.change(seccion, { target: { value: "Cumpleaños" } });
    // Solo los textos que piden aceptación.
    const textoFiltro = screen.getByLabelText("Texto");
    expect(
      within(textoFiltro)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Todos", "Cumpleaños público"]);
    fireEvent.change(textoFiltro, { target: { value: "cumpleanos_publico" } });
    fireEvent.change(screen.getByLabelText("Estado"), {
      target: { value: "retirada" },
    });
    await waitFor(() =>
      expect(servicio.aceptaciones).toHaveBeenLastCalledWith({
        page: 1,
        modulo: "Mi perfil",
        seccion: "Cumpleaños",
        clave: "cumpleanos_publico",
        estado: "retirada",
      }),
    );
  });

  it("llega con el texto elegido desde la URL", async () => {
    pintarAceptaciones(
      "/admin/privacidad/aceptaciones?clave=acuerdo_confidencialidad",
    );
    await waitFor(() =>
      expect(servicio.aceptaciones).toHaveBeenCalledWith({
        page: 1,
        clave: "acuerdo_confidencialidad",
      }),
    );
  });

  it("pagina con «Siguiente»", async () => {
    servicio.aceptaciones.mockResolvedValue({
      count: 40,
      next: "?page=2",
      previous: null,
      results: [aceptacion()],
    });
    pintarAceptaciones();
    await screen.findByText("Ana Pérez");
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    await waitFor(() =>
      expect(servicio.aceptaciones).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );
  });

  it("el detalle muestra el texto exacto que se aceptó", async () => {
    pintarAceptaciones();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Ver texto aceptado por Ana Pérez: Cumpleaños público",
      }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: /Cumpleaños público: Ana Pérez/,
    });
    expect(servicio.aceptacion).toHaveBeenCalledWith(11);
    expect(
      await within(ventana).findByText("Texto exacto que aceptó"),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText(
        "Acepto exactamente este texto del cumpleaños.",
      ),
    ).toBeInTheDocument();
    expect(within(ventana).getByText("Firefox")).toBeInTheDocument();
  });

  it("sin el texto exacto, muestra el de su versión y lo dice", async () => {
    servicio.aceptacion.mockResolvedValue({
      ...MIGRADA,
      titulo: "",
      texto: "",
      texto_de_la_version: {
        titulo: "",
        texto: "El texto de la versión 1 del aniversario.",
      },
    });
    pintarAceptaciones();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Ver texto aceptado por Íñigo Núñez: Aniversario público",
      }),
    );
    const ventana = await screen.findByRole("dialog");
    expect(
      await within(ventana).findByText("Texto de la versión 1"),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText(/No se guardó el texto exacto/),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText("El texto de la versión 1 del aniversario."),
    ).toBeInTheDocument();
    expect(within(ventana).getByText("Retirada el")).toBeInTheDocument();
  });

  it("exporta a Excel con los filtros vigentes", async () => {
    pintarAceptaciones("/admin/privacidad/aceptaciones?estado=vigente");
    await screen.findByText("Ana Pérez");
    fireEvent.click(screen.getByRole("button", { name: /Exportar a Excel/ }));
    await waitFor(() =>
      expect(servicio.exportarAceptaciones).toHaveBeenCalledWith(
        expect.objectContaining({ estado: "vigente" }),
      ),
    );
    expect(
      await screen.findByText(
        "Se descargó aceptaciones-proteccion-datos.xlsx.",
      ),
    ).toBeInTheDocument();
  });

  it("si exportar falla, lo dice en una alerta", async () => {
    servicio.exportarAceptaciones.mockRejectedValue({
      response: {
        status: 429,
        data: { error: { message: "Espere un momento." } },
      },
    });
    pintarAceptaciones();
    await screen.findByText("Ana Pérez");
    fireEvent.click(screen.getByRole("button", { name: /Exportar a Excel/ }));
    const error = await screen.findByText("Espere un momento.");
    expect(error.closest('[role="alert"]')).not.toBeNull();
  });

  it("«Restablecidas» se pide al servidor con estado=restablecida (y el Excel también)", async () => {
    const LUCIA = aceptacion({
      id: 13,
      persona: { id: 42, nombre: "Lucía Soto", usuario: "lsoto" },
      estado: "restablecida",
      vigente: false,
      restablecida_en: "2026-11-05T08:00:00-05:00",
    });
    pintarAceptaciones();
    await screen.findByText("Íñigo Núñez");
    servicio.aceptaciones.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [LUCIA],
    });
    fireEvent.change(screen.getByLabelText("Estado"), {
      target: { value: "restablecida" },
    });
    await waitFor(() =>
      expect(servicio.aceptaciones).toHaveBeenLastCalledWith({
        page: 1,
        estado: "restablecida",
      }),
    );
    expect(await screen.findByText("Lucía Soto")).toBeInTheDocument();
    // El servidor filtra: total y paginación son los suyos.
    expect(screen.getByText("1 aceptación")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Exportar a Excel/ }));
    await waitFor(() =>
      expect(servicio.exportarAceptaciones).toHaveBeenCalledWith(
        expect.objectContaining({ estado: "restablecida" }),
      ),
    );
  });

  it("con demasiadas filas, el Excel dice el tope del servidor", async () => {
    servicio.exportarAceptaciones.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: "demasiadas_filas",
            message: "Hay demasiadas aceptaciones para un Excel.",
            details: { tope: 50000 },
          },
        },
      },
    });
    pintarAceptaciones();
    await screen.findByText("Ana Pérez");
    fireEvent.click(screen.getByRole("button", { name: /Exportar a Excel/ }));
    const error = await screen.findByText(/Hay demasiadas aceptaciones/);
    expect(error).toHaveTextContent("máximo 50.000 filas");
    expect(error.closest('[role="alert"]')).not.toBeNull();
  });

  it("sin aceptaciones con filtros, ofrece limpiarlos", async () => {
    servicio.aceptaciones.mockResolvedValue({
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    pintarAceptaciones("/admin/privacidad/aceptaciones?estado=retirada");
    fireEvent.click(
      await screen.findByRole("button", { name: "Limpiar filtros" }),
    );
    await waitFor(() =>
      expect(servicio.aceptaciones).toHaveBeenLastCalledWith({ page: 1 }),
    );
  });

  it("en el teléfono, cada aceptación es una tarjeta", async () => {
    const original = window.matchMedia;
    window.matchMedia = (query) => ({
      ...original(query),
      matches: query.includes("max-width"),
    });
    try {
      pintarAceptaciones();
      const lista = await screen.findByRole("list", { name: "Aceptaciones" });
      expect(within(lista).getAllByRole("listitem")).toHaveLength(2);
      expect(screen.queryByRole("table")).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it("con el aviso elegido, muestra las personas frente al aviso y restablece", async () => {
    permisos.lista = ["privacidad.atender"];
    pintarAceptaciones(
      "/admin/privacidad/aceptaciones?clave=aviso_privacidad&vista=personas",
    );
    expect(
      await screen.findByRole("heading", { name: "Aviso vigente (versión 3)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Personas frente al aviso" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      await screen.findByRole("button", { name: "Restablecer a Ana Pérez" }),
    );
    await waitFor(() =>
      expect(servicio.restablecerConsentimiento).toHaveBeenCalledWith(40),
    );
    // Y vuelve al registro de aceptaciones.
    fireEvent.click(
      screen.getByRole("button", { name: "Registro de aceptaciones" }),
    );
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("mientras restablece, el botón dice «Restableciendo…» y no repite el pedido", async () => {
    permisos.lista = ["privacidad.atender"];
    let terminar;
    servicio.restablecerConsentimiento.mockReturnValue(
      new Promise((r) => {
        terminar = r;
      }),
    );
    servicio.restablecerTodos.mockReturnValue(new Promise(() => {}));
    pintarAceptaciones(
      "/admin/privacidad/aceptaciones?clave=aviso_privacidad&vista=personas",
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Restablecer a Ana Pérez" }),
    );
    const boton = await screen.findByRole("button", {
      name: "Restableciendo… a Ana Pérez",
    });
    expect(boton).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(boton);
    await waitFor(() =>
      expect(servicio.restablecerConsentimiento).toHaveBeenCalledTimes(1),
    );
    terminar({ aceptaciones: [] });
    expect(
      await screen.findByRole("button", { name: "Restablecer a Ana Pérez" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /Restablecer a todas/ }),
    );
    const todas = await screen.findByRole("button", {
      name: "Restableciendo…",
    });
    expect(todas).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(todas);
    await waitFor(() =>
      expect(servicio.restablecerTodos).toHaveBeenCalledTimes(1),
    );
  });

  it("desde cualquier filtro se llega a quién falta por aceptar el aviso", async () => {
    pintarAceptaciones();
    await screen.findByText("Íñigo Núñez");
    fireEvent.click(
      screen.getByRole("button", {
        name: /Ver quién falta por aceptar el aviso/,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Aviso vigente (versión 3)" }),
    ).toBeInTheDocument();
    expect(servicio.personasConsentimiento).toHaveBeenCalled();
  });
});
