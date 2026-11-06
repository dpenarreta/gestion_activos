import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El buscador de la cabecera.
 *
 * Lo que se prueba es la decisión que toma con lo tecleado, porque es la que
 * ahorra el trabajo: si corresponde a la etiqueta de un equipo abre su ficha
 * —que es lo que se espera al pistolear—, y si no, deja el inventario
 * buscando ese texto en vez de un error.
 *
 * Búsqueda en vivo (06/11/2026): mientras se escribe no navega; sugiere los
 * equipos que coinciden en una lista accesible (combobox), y Enter sin nada
 * marcado sigue haciendo lo de siempre.
 */

const porCodigo = vi.fn();
const listar = vi.fn();
const periodos = vi.fn();
let permisos = [];

vi.mock("../src/api/activosService", () => ({
  activosService: {
    porCodigo: (...args) => porCodigo(...args),
    list: (...args) => listar(...args),
  },
}));

vi.mock("../src/api/matrizService", () => ({
  matrizService: {
    periodos: (...args) => periodos(...args),
  },
}));

vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.includes(codename),
}));

const { BusquedaGlobal } =
  await import("../src/components/admin/BusquedaGlobal/BusquedaGlobal");

const EQUIPOS = [
  {
    id: 7,
    codigo_barras: "GA-LAP-000007",
    nombre: "Laptop Jefatura TI",
    marca: "Dell",
    modelo: "Latitude",
    numero_serie: "DL5440",
    responsables_resumen: "María Pérez",
  },
  {
    id: 8,
    codigo_barras: "GA-LAP-000008",
    nombre: "Laptop Contabilidad",
    marca: "Lenovo",
    modelo: "ThinkPad",
    numero_serie: "TP1",
    responsables_resumen: "",
  },
];

function Destino() {
  const ubicacion = useLocation();
  return (
    <div data-testid="destino">{ubicacion.pathname + ubicacion.search}</div>
  );
}

function pintar() {
  return render(
    <MemoryRouter initialEntries={["/admin/alertas"]}>
      <Routes>
        <Route path="/admin/alertas" element={<BusquedaGlobal />} />
        <Route path="*" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

const campoDeEquipos = () =>
  screen.getByRole("combobox", { name: /buscar un equipo/i });

function buscar(texto) {
  const campo = campoDeEquipos();
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.submit(campo.closest("form"));
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos = ["activos.ver"];
  listar.mockResolvedValue({ results: EQUIPOS, count: 2 });
});

describe("El buscador de la cabecera", () => {
  it("una etiqueta conocida abre la ficha de ese equipo", async () => {
    porCodigo.mockResolvedValue({ activo: { id: 46, nombre: "PC Recepción" } });

    pintar();
    buscar("GA-PCE-000004");

    await waitFor(() =>
      expect(screen.getByTestId("destino")).toHaveTextContent(
        "/admin/activos/46",
      ),
    );
    expect(porCodigo).toHaveBeenCalledWith("GA-PCE-000004");
  });

  it("la pistola (código y Enter de golpe) no pide sugerencias", async () => {
    porCodigo.mockResolvedValue({ activo: { id: 46, nombre: "PC Recepción" } });

    pintar();
    buscar("GA-PCE-000004");

    await waitFor(() =>
      expect(screen.getByTestId("destino")).toHaveTextContent(
        "/admin/activos/46",
      ),
    );
    await new Promise((resolver) => setTimeout(resolver, 350));
    expect(listar).not.toHaveBeenCalled();
  });

  it("lo que no es una etiqueta lleva al inventario buscando ese texto", async () => {
    /* Buscar por nombre o por persona es tan común como escanear, y un 404
       en la cara sería un castigo por escribir «Jorge». */
    porCodigo.mockRejectedValue({ response: { status: 404 } });

    pintar();
    buscar("Jorge Ramírez");

    await waitFor(() =>
      expect(screen.getByTestId("destino")).toHaveTextContent(
        "/admin/activos?q=Jorge%20Ram%C3%ADrez",
      ),
    );
  });

  it("si el servidor falla tampoco deja la cabecera en silencio", async () => {
    /* Un 500 también cae al listado: allí hay una pantalla que sabe decir que
       algo falló, y aquí no. */
    porCodigo.mockRejectedValue({ response: { status: 500 } });

    pintar();
    buscar("lo que sea");

    await waitFor(() =>
      expect(screen.getByTestId("destino")).toHaveTextContent(
        "/admin/activos?q=",
      ),
    );
  });

  it("no busca con el campo vacío", () => {
    pintar();
    buscar("   ");

    expect(porCodigo).not.toHaveBeenCalled();
    expect(screen.queryByTestId("destino")).not.toBeInTheDocument();
  });

  it("quien no ve el inventario no lo tiene", () => {
    /* Ofrecérselo acabaría en un 403 o en un listado vacío que parece un
       fallo del sistema. */
    permisos = [];
    pintar();

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("Sugerencias en vivo", () => {
  it("al escribir sugiere equipos sin salir de la pantalla", async () => {
    pintar();
    const campo = campoDeEquipos();
    expect(campo).toHaveAttribute("aria-expanded", "false");

    fireEvent.change(campo, { target: { value: "lap" } });

    expect(
      await screen.findByRole("option", { name: /Laptop Jefatura TI/ }),
    ).toBeInTheDocument();
    expect(listar).toHaveBeenCalledWith(
      expect.objectContaining({ q: "lap", page_size: 6 }),
    );
    expect(campo).toHaveAttribute("aria-expanded", "true");
    // No navegó: sigue en la pantalla de origen.
    expect(screen.queryByTestId("destino")).not.toBeInTheDocument();
    // El total se anuncia sin mover el foco.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((r) => r.textContent === "2 sugerencias"),
      ).toBe(true),
    );
  });

  it("con las flechas se marca una y Enter abre su ficha", async () => {
    pintar();
    const campo = campoDeEquipos();
    fireEvent.change(campo, { target: { value: "lap" } });
    await screen.findByRole("option", { name: /Laptop Contabilidad/ });

    fireEvent.keyDown(campo, { key: "ArrowDown" });
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    const marcada = screen.getByRole("option", {
      name: /Laptop Contabilidad/,
    });
    expect(marcada).toHaveAttribute("aria-selected", "true");
    expect(campo).toHaveAttribute("aria-activedescendant", marcada.id);

    fireEvent.submit(campo.closest("form"));

    await waitFor(() =>
      expect(screen.getByTestId("destino")).toHaveTextContent(
        "/admin/activos/8",
      ),
    );
    expect(porCodigo).not.toHaveBeenCalled();
  });

  it("«Ver todos» abre el inventario filtrado; Escape cierra la lista", async () => {
    pintar();
    const campo = campoDeEquipos();
    fireEvent.change(campo, { target: { value: "lap" } });
    await screen.findByRole("option", { name: /Laptop Jefatura TI/ });

    fireEvent.keyDown(campo, { key: "Escape" });
    expect(campo).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(campo, { key: "ArrowUp" });
    fireEvent.mouseDown(
      screen.getByRole("option", { name: /Ver todos los resultados/ }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("destino")).toHaveTextContent(
        "/admin/activos?q=lap",
      ),
    );
  });

  it("sin coincidencias lo dice", async () => {
    listar.mockResolvedValue({ results: [], count: 0 });
    pintar();
    fireEvent.change(campoDeEquipos(), { target: { value: "zzz" } });

    expect(
      await screen.findByText(
        "Sin sugerencias para «zzz». Pulse Enter para buscarlo en el inventario.",
      ),
    ).toBeInTheDocument();
  });

  it("Escape con «Sin sugerencias» a la vista cierra el panel sin borrar lo escrito", async () => {
    listar.mockResolvedValue({ results: [], count: 0 });
    pintar();
    const campo = campoDeEquipos();
    fireEvent.change(campo, { target: { value: "zzz" } });
    await screen.findByText(/Sin sugerencias para «zzz»/);

    const evento = fireEvent.keyDown(campo, { key: "Escape" });
    // `fireEvent` devuelve false si se canceló el comportamiento nativo
    // (el que vacía un `type="search"`).
    expect(evento).toBe(false);
    expect(campo).toHaveValue("zzz");
    expect(screen.queryByText(/Sin sugerencias para/)).not.toBeVisible();
  });

  it("anuncia cuántas sugerencias hay de cuántas en total", async () => {
    listar.mockResolvedValue({ results: EQUIPOS, count: 12 });
    pintar();
    fireEvent.change(campoDeEquipos(), { target: { value: "lap" } });

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some(
            (r) =>
              r.textContent ===
              "2 sugerencias de 12; «Ver todos» para el resto",
          ),
      ).toBe(true),
    );
    expect(
      screen.getByRole("listbox", { name: "Sugerencias para lap" }),
    ).toBeInTheDocument();
  });
});

describe("Solo dentro de Gestión de Activos", () => {
  it.each([
    "/admin/institucional/inicio",
    "/admin/soporte/bandeja",
    "/admin/dashboards",
    "/admin/ordenes/panel",
    "/admin/users",
    "/admin/perfil",
  ])("en %s no hay buscador de códigos", (ruta) => {
    permisos = ["activos.ver"];
    render(
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="*" element={<BusquedaGlobal />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("en el inventario sí", () => {
    permisos = ["activos.ver"];
    render(
      <MemoryRouter initialEntries={["/admin/activos"]}>
        <Routes>
          <Route path="*" element={<BusquedaGlobal />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(campoDeEquipos()).toBeInTheDocument();
  });
});

/*
 * Auditoría UX/UI, fase 3 (28/10/2026): en la Matriz la barra saltaba a la
 * lista de obligaciones 250 ms después de escribir, desde cualquier pantalla.
 * Ahora filtra en vivo solo estando en la lista; desde las demás sugiere
 * períodos y abre la lista con Enter.
 */
describe("En la Matriz", () => {
  function pintarEn(ruta) {
    return render(
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <BusquedaGlobal />
                <Destino />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("desde otra pantalla no se va a mitad de escribir: sugiere y espera al Enter", async () => {
    periodos.mockResolvedValue({
      results: [
        {
          id: 31,
          codigo: "IVA-2026-10",
          obligacion: { nombre: "Declaración de IVA" },
          area: "Tributario",
          responsable: { nombre: "Ana" },
        },
      ],
    });
    pintarEn("/admin/matriz");
    const campo = screen.getByRole("combobox", {
      name: "Buscar en la matriz",
    });

    fireEvent.change(campo, { target: { value: "iva" } });
    expect(
      await screen.findByRole("option", { name: /Declaración de IVA/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("destino")).toHaveTextContent(
      /^\/admin\/matriz$/,
    );

    fireEvent.submit(campo.closest("form"));
    await waitFor(() =>
      expect(screen.getByTestId("destino")).toHaveTextContent(
        "/admin/matriz/obligaciones?q=iva",
      ),
    );
  });

  it("en la lista de obligaciones filtra en vivo, sin Enter y sin perder los demás filtros", async () => {
    pintarEn("/admin/matriz/obligaciones?area=3");

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar en la matriz" }),
      { target: { value: "iva" } },
    );

    await waitFor(() =>
      expect(screen.getByTestId("destino")).toHaveTextContent(
        "/admin/matriz/obligaciones?area=3&q=iva",
      ),
    );
  });
});
