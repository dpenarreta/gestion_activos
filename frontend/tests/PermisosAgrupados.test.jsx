import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Los permisos, agrupados por la parte del sistema a la que pertenecen: los
 * generales (valen en todo el sistema) y los de cada módulo. Cada grupo es un
 * acordeón que se abre y se cierra.
 */

const GENERAL = {
  id: "general",
  label: "General del sistema",
  alcance: "general",
  description: "Valen en todo el sistema.",
  orden: 0,
};
const MATRIZ = {
  id: "matriz",
  label: "Matriz de obligaciones",
  alcance: "modulo",
  description: "Solo sirven en la Matriz.",
  orden: 2,
};
const CATALOGO = {
  // Fuera de orden a propósito: manda el `orden` del grupo.
  matriz: {
    label: "Matriz",
    description: "Obligaciones.",
    grupo: MATRIZ,
    permissions: { "matriz.crear": "Crear obligaciones" },
  },
  usuarios: {
    label: "Usuarios",
    description: "Cuentas.",
    grupo: GENERAL,
    permissions: {
      "usuarios.ver": "Ver usuarios",
      "usuarios.crear": "Crear usuarios",
    },
  },
};

vi.mock("../src/hooks/usePermissionsCatalog", () => ({
  usePermissionsCatalog: () => ({
    catalog: CATALOGO,
    isLoading: false,
    error: null,
  }),
}));

const { agruparCatalogo } = await import("../src/utils/gruposDePermisos");
const { PermissionsPanel } =
  await import("../src/pages/Admin/Permissions/PermissionsPanel");
const { PermissionsCheckboxGroup } =
  await import("../src/components/common/PermissionsCheckboxGroup/PermissionsCheckboxGroup");

function boton(nombre) {
  return screen.getByRole("button", { name: new RegExp(nombre) });
}

describe("agruparCatalogo", () => {
  it("ordena por grupo y deja en «Otros» lo que no trae grupo", () => {
    const grupos = agruparCatalogo({
      ...CATALOGO,
      suelto: { label: "Suelto", permissions: { "x.y": "X" } },
    });
    expect(grupos.map((g) => g.label)).toEqual([
      "General del sistema",
      "Matriz de obligaciones",
      "Otros",
    ]);
    expect(grupos[0].modulos.map(([clave]) => clave)).toEqual(["usuarios"]);
  });
});

describe("La pestaña Permisos", () => {
  it("muestra cada grupo cerrado, con su alcance y su cuenta", () => {
    render(<PermissionsPanel />);

    const general = boton("General del sistema");
    expect(general).toHaveAttribute("aria-expanded", "false");
    expect(within(general).getByText("General")).toBeInTheDocument();
    expect(
      within(general).getByText("1 bloque · 2 permisos"),
    ).toBeInTheDocument();
    expect(
      within(boton("Matriz de obligaciones")).getByText("Módulo"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("abre y cierra un grupo, o todos a la vez", () => {
    render(<PermissionsPanel />);

    fireEvent.click(boton("General del sistema"));
    expect(boton("General del sistema")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("usuarios.ver")).toBeVisible();
    expect(screen.queryByText("matriz.crear")).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Abrir todos" }));
    expect(screen.getByText("matriz.crear")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar todos" }));
    expect(screen.queryByText("usuarios.ver")).not.toBeVisible();
  });
});

function Selector({ inicial = [] }) {
  const [seleccion, setSeleccion] = useState(new Set(inicial));
  return (
    <PermissionsCheckboxGroup
      catalog={CATALOGO}
      selected={seleccion}
      onChange={setSeleccion}
    />
  );
}

describe("El selector del rol", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cuenta lo seleccionado por grupo y marca el grupo entero de una vez", () => {
    render(<Selector inicial={["usuarios.ver"]} />);

    expect(
      within(boton("General del sistema")).getByText("1 de 2 seleccionados"),
    ).toBeInTheDocument();
    const todoGeneral = screen.getByRole("checkbox", {
      name: "Todo General del sistema",
    });
    expect(todoGeneral.indeterminate).toBe(true);

    fireEvent.click(todoGeneral);
    expect(
      within(boton("General del sistema")).getByText("2 de 2 seleccionados"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 de 3 permisos seleccionados"),
    ).toBeInTheDocument();
  });

  it("al buscar abre los grupos con resultados y esconde los demás", () => {
    render(<Selector />);

    fireEvent.change(screen.getByPlaceholderText("Buscar permiso"), {
      target: { value: "obligaciones" },
    });

    expect(boton("Matriz de obligaciones")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText(/Crear obligaciones/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /General del sistema/ }),
    ).toBeNull();
  });
});
