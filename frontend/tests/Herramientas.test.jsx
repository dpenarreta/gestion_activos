import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Mis herramientas (en «Mi perfil») y la gestión del catálogo con quién usa
 * cada herramienta (pide `herramientas.gestionar`).
 */

const misDatos = { herramientas: vi.fn(), guardarHerramientas: vi.fn() };
vi.mock("../src/api/misDatosService", () => ({ misDatosService: misDatos }));
const servicio = {
  uso: vi.fn(),
  crear: vi.fn(),
  actualizar: vi.fn(),
  eliminar: vi.fn(),
  usuarios: vi.fn(),
  darAcceso: vi.fn(),
  quitarAcceso: vi.fn(),
  personas: vi.fn(),
};
vi.mock("../src/api/herramientasService", () => ({
  herramientasService: servicio,
}));

const { MisHerramientas } =
  await import("../src/pages/MisDatos/MisHerramientas");
const { HerramientasPage } =
  await import("../src/pages/Institucional/HerramientasPage");

const CATALOGO = [
  { id: 1, nombre: "Claude", tipo: "externa" },
  { id: 2, nombre: "Gmail", tipo: "externa" },
  { id: 3, nombre: "Zimbra", tipo: "interna" },
];

beforeEach(() => vi.clearAllMocks());

describe("Mis herramientas", () => {
  it("muestra las suyas por tipo y al editar guarda las marcadas con su cuenta", async () => {
    misDatos.herramientas.mockResolvedValue({
      mias: [{ ...CATALOGO[0], cuenta: "rosa@grupolaar.com" }],
      catalogo: CATALOGO,
    });
    misDatos.guardarHerramientas.mockResolvedValue({
      mias: [
        { ...CATALOGO[0], cuenta: "rosa@grupolaar.com" },
        { ...CATALOGO[2], cuenta: "rvera" },
      ],
      catalogo: CATALOGO,
    });
    render(<MisHerramientas />);
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.getByText(/rosa@grupolaar.com/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Editar/ }));
    const ventana = screen.getByRole("dialog", { name: "Mis herramientas" });
    expect(within(ventana).getByLabelText("Su usuario en Claude")).toHaveValue(
      "rosa@grupolaar.com",
    );
    fireEvent.click(within(ventana).getByRole("checkbox", { name: "Zimbra" }));
    // El usuario es obligatorio; el detalle, no.
    expect(
      within(ventana).getByLabelText("Su usuario en Zimbra"),
    ).toBeRequired();
    expect(
      within(ventana).getByLabelText("Detalle de Zimbra"),
    ).not.toBeRequired();
    fireEvent.change(within(ventana).getByLabelText("Su usuario en Zimbra"), {
      target: { value: "rvera" },
    });
    fireEvent.change(within(ventana).getByLabelText("Detalle de Zimbra"), {
      target: { value: "Correo interno" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(misDatos.guardarHerramientas).toHaveBeenCalledWith([
        { herramienta: 1, cuenta: "rosa@grupolaar.com", detalle: "" },
        { herramienta: 3, cuenta: "rvera", detalle: "Correo interno" },
      ]),
    );
    expect(
      await screen.findByText("Sus herramientas quedaron guardadas."),
    ).toBeInTheDocument();
  });
});

describe("Herramientas y licencias", () => {
  it("muestra quién usa cada una y agrega herramientas al catálogo", async () => {
    servicio.uso.mockResolvedValue([
      {
        ...CATALOGO[0],
        activa: true,
        descripcion: "",
        usuarios: [
          {
            id: 9,
            nombre: "Rosa Vera",
            correo: "rosa@grupolaar.com",
            cuenta: "rosa@grupolaar.com",
            activo: false,
          },
        ],
      },
      { ...CATALOGO[1], activa: true, descripcion: "", usuarios: [] },
    ]);
    servicio.crear.mockResolvedValue({});
    render(<HerramientasPage />);
    expect(await screen.findByText(/Rosa Vera/)).toBeInTheDocument();
    expect(screen.getByText("Cuenta deshabilitada")).toBeInTheDocument();
    expect(screen.getByText("Nadie la usa todavía.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Catálogo" }));
    expect(
      screen.getByRole("button", { name: "Borrar Claude" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Nueva herramienta/ }));
    const ventana = screen.getByRole("dialog", { name: "Nueva herramienta" });
    fireEvent.change(within(ventana).getByLabelText(/^Nombre/), {
      target: { value: "Fenix" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Tipo/), {
      target: { value: "interna" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.crear).toHaveBeenCalledWith(
        expect.objectContaining({ nombre: "Fenix", tipo: "interna" }),
      ),
    );
    expect(
      await screen.findByText("Herramienta agregada."),
    ).toBeInTheDocument();
  });
});

describe("Lo que pide su cargo en «Mi perfil»", () => {
  it("en «Mi perfil» se ve la base del cargo y lo que falta registrar", async () => {
    misDatos.herramientas.mockResolvedValue({
      mias: [{ ...CATALOGO[0], cuenta: "" }],
      catalogo: CATALOGO,
      cargo: { id: 102, nombre: "Analista Programador" },
      base: [CATALOGO[0], CATALOGO[2]],
    });
    render(<MisHerramientas />);
    const base = await screen.findByLabelText("Herramientas base de su cargo");
    expect(within(base).getByText(/Analista Programador/)).toBeInTheDocument();
    expect(
      within(base).getByText(/No tiene registradas: Zimbra/),
    ).toBeInTheDocument();
  });
});

describe("Personas con acceso, desde el catálogo", () => {
  it("al editar una herramienta se ven, se agregan y se quitan personas", async () => {
    servicio.uso.mockResolvedValue([
      { ...CATALOGO[0], activa: true, descripcion: "", usuarios: [] },
    ]);
    servicio.usuarios.mockResolvedValue([
      {
        id: 9,
        nombre: "Rosa Vera",
        correo: "rosa@grupolaar.com",
        cuenta: "",
        activo: true,
      },
    ]);
    servicio.personas.mockResolvedValue([
      { id: 9, nombre: "Rosa Vera", correo: "rosa@grupolaar.com" },
      { id: 12, nombre: "Pedro Mora", correo: "pedro@grupolaar.com" },
    ]);
    servicio.darAcceso.mockResolvedValue([
      {
        id: 9,
        nombre: "Rosa Vera",
        correo: "rosa@grupolaar.com",
        cuenta: "",
        activo: true,
      },
      {
        id: 12,
        nombre: "Pedro Mora",
        correo: "pedro@grupolaar.com",
        cuenta: "pmora",
        activo: true,
      },
    ]);
    servicio.quitarAcceso.mockResolvedValue([]);
    render(<HerramientasPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Catálogo" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Claude" }));
    const ventana = screen.getByRole("dialog", { name: "Editar Claude" });
    expect(
      await within(ventana).findByText("Personas con acceso (1)"),
    ).toBeInTheDocument();

    fireEvent.change(within(ventana).getByLabelText("Agregar persona"), {
      target: { value: "ped" },
    });
    // Rosa ya tiene acceso: no se puede volver a elegir.
    expect(
      await within(ventana).findByRole("option", { name: /Rosa Vera/ }),
    ).toBeDisabled();
    fireEvent.click(
      within(ventana).getByRole("option", { name: /Pedro Mora/ }),
    );
    // Sin su usuario en la herramienta no se agrega.
    const agregar = within(ventana).getByRole("button", { name: /Agregar$/ });
    expect(agregar).toBeDisabled();
    fireEvent.change(
      within(ventana).getByLabelText(/Usuario en la herramienta/),
      { target: { value: "pmora" } },
    );
    fireEvent.change(
      within(ventana).getByLabelText("Detalle o descripción (opcional)"),
      { target: { value: "Licencia Pro" } },
    );
    expect(agregar).toBeEnabled();
    fireEvent.click(agregar);
    await waitFor(() =>
      expect(servicio.darAcceso).toHaveBeenCalledWith(
        1,
        12,
        "pmora",
        "Licencia Pro",
      ),
    );
    expect(
      await within(ventana).findByText("Personas con acceso (2)"),
    ).toBeInTheDocument();

    fireEvent.click(
      within(ventana).getByRole("button", { name: "Quitar a Rosa Vera" }),
    );
    await waitFor(() =>
      expect(servicio.quitarAcceso).toHaveBeenCalledWith(1, 9),
    );
  });
});
