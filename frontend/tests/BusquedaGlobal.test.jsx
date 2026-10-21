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
 */

const porCodigo = vi.fn();
let permisos = [];

vi.mock("../src/api/activosService", () => ({
  activosService: {
    porCodigo: (...args) => porCodigo(...args),
  },
}));

vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.includes(codename),
}));

const { BusquedaGlobal } =
  await import("../src/components/admin/BusquedaGlobal/BusquedaGlobal");

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

function buscar(texto) {
  const campo = screen.getByRole("searchbox", { name: /buscar un equipo/i });
  fireEvent.change(campo, { target: { value: texto } });
  fireEvent.submit(campo.closest("form"));
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos = ["activos.ver"];
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

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
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
    expect(
      screen.getByRole("searchbox", { name: /buscar un equipo/i }),
    ).toBeInTheDocument();
  });
});
