import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Matriz de obligaciones, fase 1: la entrada del módulo y sus catálogos.
 *
 * Cobertura de AC-MTZ-006 (la entrada de la Matriz, AC-MTZ-004, pasó a
 * MatrizFase2.test.jsx con el tablero).
 */

const misEmpresas = vi.fn();
const listar = vi.fn();
const crear = vi.fn();
const eliminar = vi.fn();
let empresaActiva = "1";

vi.mock("../src/api/matrizService", () => ({
  matrizService: { misEmpresas: (...a) => misEmpresas(...a) },
  catalogoMatrizService: () => ({
    list: (...a) => listar(...a),
    create: (...a) => crear(...a),
    update: vi.fn(),
    remove: (...a) => eliminar(...a),
  }),
}));

vi.mock("../src/api/client", () => ({
  getEmpresaActiva: () => empresaActiva,
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codigo) => permisos.has(codigo),
}));

const { CatalogoMatrizPage } =
  await import("../src/pages/Matriz/CatalogoMatrizPage");

const COURIER = {
  id: 1,
  nombre: "LaarCourier",
  codigo: "LC",
  color: "#164B86",
  zona_horaria: "America/Guayaquil",
  roles: ["Responsable de cumplimiento"],
  capacidades: ["matriz.cargar", "matriz.enviar"],
};

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  empresaActiva = "1";
  misEmpresas.mockResolvedValue({ empresas: [COURIER] });
  listar.mockResolvedValue([
    { id: 1, codigo: "CONT", nombre: "Contabilidad y Tributario" },
  ]);
});

describe("Áreas y entidades de control", () => {
  function pintar(tipo = "areas") {
    return render(
      <MemoryRouter>
        <CatalogoMatrizPage tipo={tipo} />
      </MemoryRouter>,
    );
  }

  it("se consultan sin el permiso de editar, pero no se cambian", async () => {
    pintar();

    expect(
      await screen.findByText("Contabilidad y Tributario"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nueva área/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("con permiso se crea una nueva", async () => {
    permisos.add("catalogos.editar");
    crear.mockResolvedValue({});

    pintar("entidades-control");

    fireEvent.click(
      await screen.findByRole("button", { name: /Nueva entidad de control/ }),
    );
    fireEvent.change(screen.getByLabelText("Código"), {
      target: { value: "SUPERCIAS" },
    });
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Superintendencia de Compañías" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(crear).toHaveBeenCalledWith({
        codigo: "SUPERCIAS",
        nombre: "Superintendencia de Compañías",
      }),
    );
  });

  it("eliminar pide confirmación, y si está en uso dice por qué", async () => {
    permisos.add("catalogos.editar");
    eliminar.mockRejectedValue({
      response: {
        data: {
          error: {
            message: "No se puede eliminar: hay obligaciones que lo usan.",
          },
        },
      },
    });

    pintar();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Eliminar Contabilidad y Tributario",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(
      await screen.findByText(
        "No se puede eliminar: hay obligaciones que lo usan.",
      ),
    ).toBeInTheDocument();
  });
});
