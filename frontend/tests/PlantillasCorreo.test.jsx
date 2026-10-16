import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Configuración → Notificaciones → Plantillas de correo: la lista de todos los
 * correos del sistema y el editor con vista previa y variables.
 */

const servicio = {
  list: vi.fn(),
  get: vi.fn(),
  guardar: vi.fn(),
  restablecer: vi.fn(),
  vistaPrevia: vi.fn(),
  probar: vi.fn(),
};
vi.mock("../src/api/plantillasCorreoService", () => ({
  plantillasCorreoService: servicio,
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codigo) => permisos.has(codigo),
}));
const setIsDirty = vi.fn();
vi.mock("../src/context/UnsavedChangesContext", () => ({
  useUnsavedChanges: () => ({ setIsDirty }),
}));

const { PlantillasCorreoPage } =
  await import("../src/pages/Admin/Configuracion/PlantillasCorreoPage");
const { PlantillaCorreoEditor } =
  await import("../src/pages/Admin/Configuracion/PlantillaCorreoEditor");

const DETALLE = {
  clave: "mantenimientos.entrada",
  nombre: "Equipo entró a mantenimiento",
  modulo: "Gestión de Activos · Mantenimientos",
  descripcion: "Al registrar que un equipo entra a reparación.",
  personalizada: false,
  asunto: "Equipo en mantenimiento: {{codigo}}",
  html: "<p>{{equipo}}</p>",
  asunto_por_defecto: "Equipo en mantenimiento: {{codigo}}",
  html_por_defecto: "<p>{{equipo}}</p>",
  variables: [
    {
      nombre: "sistema",
      descripcion: "Nombre del sistema",
      ejemplo: "Gestión de Activos",
      html: false,
      comun: true,
    },
    {
      nombre: "equipo",
      descripcion: "Nombre del equipo",
      ejemplo: "Laptop",
      html: false,
      comun: false,
    },
    {
      nombre: "codigo",
      descripcion: "Código de barras",
      ejemplo: "ACT-1",
      html: false,
      comun: false,
    },
  ],
};

function pintarEditor() {
  return render(
    <MemoryRouter
      initialEntries={[
        "/admin/configuracion/notificaciones/plantillas/mantenimientos.entrada",
      ]}
    >
      <Routes>
        <Route
          path="/admin/configuracion/notificaciones/plantillas/:clave"
          element={<PlantillaCorreoEditor />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  permisos.add("configuracion.ver");
  servicio.get.mockResolvedValue(DETALLE);
  servicio.vistaPrevia.mockResolvedValue({
    asunto: "Equipo en mantenimiento: ACT-1",
    html: "<p>Laptop</p>",
    texto: "Laptop",
    desconocidas: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("La lista", () => {
  it("agrupa los correos por módulo y dice si están personalizados", async () => {
    servicio.list.mockResolvedValue([
      {
        ...DETALLE,
        personalizada: true,
        actualizado_por: "Diana Salazar",
        actualizado_en: "2026-10-16T10:00:00Z",
      },
      {
        clave: "matriz.vencimiento",
        nombre: "Hoy vence una obligación",
        modulo: "Matriz de obligaciones",
        descripcion: "El día del vencimiento.",
        personalizada: false,
      },
    ]);
    render(
      <MemoryRouter>
        <PlantillasCorreoPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Gestión de Activos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Matriz de obligaciones" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Personalizado")).toBeInTheDocument();
    expect(screen.getByText("Por defecto")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Editar" })[1]).toHaveAttribute(
      "href",
      "/admin/configuracion/notificaciones/plantillas/matriz.vencimiento",
    );
  });
});

describe("El editor", () => {
  it("muestra la vista previa en un marco aislado y las variables", async () => {
    pintarEditor();

    expect(
      await screen.findByText("Equipo entró a mantenimiento"),
    ).toBeInTheDocument();
    const marco = await screen.findByTitle("Vista previa del correo");
    expect(marco).toHaveAttribute("sandbox", "");
    expect(
      screen.getByText("Equipo en mantenimiento: ACT-1"),
    ).toBeInTheDocument();
    expect(screen.getByText("{{equipo}}")).toBeInTheDocument();
    expect(screen.getByText("Comunes a todos los correos")).toBeInTheDocument();
    // Sin permiso de editar: campos bloqueados y sin botones de guardar.
    expect(screen.getByLabelText("HTML del correo")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
  });

  it("inserta la variable en el cursor, avisa de cambios y guarda", async () => {
    permisos.add("configuracion.editar");
    servicio.guardar.mockResolvedValue({
      ...DETALLE,
      personalizada: true,
      html: "<p>{{equipo}} {{codigo}}</p>",
    });
    pintarEditor();

    const area = await screen.findByLabelText("HTML del correo");
    area.focus();
    area.setSelectionRange(area.value.length - 4, area.value.length - 4);
    fireEvent.click(
      screen.getByRole("button", { name: "Insertar {{codigo}}" }),
    );

    expect(area.value).toBe("<p>{{equipo}}{{codigo}}</p>");
    await waitFor(() => expect(setIsDirty).toHaveBeenLastCalledWith(true));

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.guardar).toHaveBeenCalledWith("mantenimientos.entrada", {
        asunto: DETALLE.asunto,
        html: "<p>{{equipo}}{{codigo}}</p>",
      }),
    );
    expect(await screen.findByText(/Plantilla guardada/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restablecer" }),
    ).toBeInTheDocument();
  });

  it("avisa de las variables que no existen", async () => {
    servicio.vistaPrevia.mockResolvedValue({
      asunto: "x",
      html: "<p>x</p>",
      texto: "x",
      desconocidas: ["inventada"],
    });
    pintarEditor();

    expect(
      await screen.findByText(/no existen en este correo/),
    ).toHaveTextContent("{{inventada}}");
  });

  it("pide la vista previa con el borrador, esperando a que se deje de escribir", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    permisos.add("configuracion.editar");
    pintarEditor();

    const asunto = await screen.findByLabelText("Asunto");
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    servicio.vistaPrevia.mockClear();
    fireEvent.change(asunto, { target: { value: "Nuevo asunto {{codigo}}" } });
    expect(servicio.vistaPrevia).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(servicio.vistaPrevia).toHaveBeenCalledWith(
      "mantenimientos.entrada",
      {
        asunto: "Nuevo asunto {{codigo}}",
        html: "<p>{{equipo}}</p>",
      },
    );
  });
});
