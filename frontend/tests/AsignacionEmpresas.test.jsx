import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COURIER = { id: 1, nombre: "LaarCourier", codigo: "LC", activa: true };
const SEGURIDAD = {
  id: 2,
  nombre: "LaarSeguridad",
  codigo: "LS",
  activa: true,
};
const ROLES = [
  { id: 10, name: "Soporte TI" },
  { id: 11, name: "Solo consulta" },
  { id: 12, name: "Auditor" },
  // Un rol de cargo del organigrama: lo pone el cargo, no se elige.
  {
    id: 30,
    name: "Jefe de bodega",
    cargo: { id: 4, nombre: "Jefe de bodega", empresa: "LaarCourier" },
  },
];

const list = vi.fn();
const get = vi.fn();
const assignEmpresas = vi.fn(() => Promise.resolve({}));
const assignRoles = vi.fn(() => Promise.resolve({}));
const listarRoles = vi.fn();

vi.mock("../src/api/empresasService", () => ({
  empresasService: { list: (...args) => list(...args) },
}));

// Sin esto el catálogo de áreas de la Matriz salía a la red de verdad y jsdom
// lo cortaba con «Cross origin … forbidden» en cada prueba. Falla a propósito,
// como hacía la red: sin catálogo las áreas no viajan (eso lo prueba Matriz).
vi.mock("../src/api/matrizService", () => ({
  catalogoMatrizService: () => ({
    list: () => Promise.reject(new Error("sin catálogo")),
  }),
}));

vi.mock("../src/api/rolesService", () => ({
  rolesService: { list: (...args) => listarRoles(...args) },
}));

vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: {
    get: (...args) => get(...args),
    assignEmpresas: (...args) => assignEmpresas(...args),
    assignRoles: (...args) => assignRoles(...args),
  },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { AsignacionEmpresas } =
  await import("../src/pages/Admin/Empresas/AsignacionEmpresas");

function usuarioCon(rolesEnCourier, globales = []) {
  return {
    roles: globales,
    empresas: [
      {
        id: 1,
        nombre: "LaarCourier",
        es_predeterminada: true,
        roles: rolesEnCourier,
      },
    ],
  };
}

function textos(select) {
  return [...select.querySelectorAll("option")].map((o) => o.textContent);
}

function guardar() {
  fireEvent.click(screen.getByRole("button", { name: "Guardar accesos" }));
}

describe("Asignación de empresas y roles a un usuario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.clear();
    permisos.add("empresas.ver");
    permisos.add("empresas.asignar");
    permisos.add("usuarios.editar");
    list.mockResolvedValue({ results: [COURIER, SEGURIDAD] });
    listarRoles.mockResolvedValue(ROLES);
    get.mockResolvedValue(usuarioCon([{ id: 10, name: "Soporte TI" }]));
  });

  // Queja de usuario (06/11/2026): el rol elegido al crear la cuenta tiene
  // que verse en la ficha con el mismo desplegable, no perdido en casillas.
  it("muestra en el desplegable el rol elegido en el alta", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByRole("combobox", { name: "Rol en LaarCourier" }),
    ).toHaveValue("10");
    expect(
      screen.getByRole("checkbox", { name: "Asignar LaarCourier" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Asignar LaarSeguridad" }),
    ).not.toBeChecked();
    // Nada de rejillas de casillas por rol.
    expect(
      screen.queryByRole("checkbox", { name: "Soporte TI" }),
    ).not.toBeInTheDocument();
  });

  it("ofrece los roles por orden alfabético y sin los de cargo", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    const rol = await screen.findByRole("combobox", {
      name: "Rol en LaarCourier",
    });
    expect(textos(rol)).toEqual([
      "Sin rol en esta empresa",
      "Auditor",
      "Solo consulta",
      "Soporte TI",
    ]);
  });

  it("cambiar el rol del desplegable cambia lo que se guarda", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.change(
      await screen.findByRole("combobox", { name: "Rol en LaarCourier" }),
      { target: { value: "11" } },
    );
    guardar();

    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [11], es_predeterminada: true },
      ]),
    );
  });

  // AC-EMP-018: el mismo usuario, distinto poder en cada empresa.
  it("guarda un rol distinto por empresa", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Asignar LaarSeguridad" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Rol en LaarSeguridad" }),
      { target: { value: "11" } },
    );
    guardar();

    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [10], es_predeterminada: true },
        { empresa_id: 2, roles: [11], es_predeterminada: false },
      ]),
    );
  });

  it("el desplegable enlaza la explicación de qué es el rol", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    const rol = await screen.findByRole("combobox", {
      name: "Rol en LaarCourier",
    });
    expect(rol).toHaveAccessibleDescription(
      /El rol define lo que puede hacer en esta empresa/,
    );
  });

  it("con un solo rol no muestra adicionales, solo el botón para añadir", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByRole("button", { name: "Añadir otro rol" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Roles adicionales")).not.toBeInTheDocument();
  });

  it("añade un segundo rol en la misma empresa", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Añadir otro rol" }),
    );
    const otro = screen.getByRole("combobox", {
      name: "Otro rol en LaarCourier",
    });
    // No se ofrece el que ya tiene.
    expect(textos(otro)).toEqual([
      "Seleccione un rol",
      "Auditor",
      "Solo consulta",
    ]);
    fireEvent.change(otro, { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    expect(
      within(screen.getByRole("list", { name: "Roles adicionales" })).getByText(
        "Solo consulta",
      ),
    ).toBeInTheDocument();
    guardar();
    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [10, 11], es_predeterminada: true },
      ]),
    );
  });

  // Cuentas migradas con dos roles en una empresa: no se rompen.
  it("con dos roles, uno va en el desplegable y el otro en adicionales", async () => {
    get.mockResolvedValue(
      usuarioCon([
        { id: 10, name: "Soporte TI" },
        { id: 12, name: "Auditor" },
      ]),
    );
    render(<AsignacionEmpresas usuarioId="7" />);

    // El principal es el primero por nombre: sale igual cada vez.
    expect(
      await screen.findByRole("combobox", { name: "Rol en LaarCourier" }),
    ).toHaveValue("12");
    const adicionales = screen.getByRole("list", {
      name: "Roles adicionales",
    });
    expect(within(adicionales).getByText("Soporte TI")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Quitar el rol Soporte TI en LaarCourier",
      }),
    );
    expect(screen.queryByText("Roles adicionales")).not.toBeInTheDocument();
    guardar();
    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [12], es_predeterminada: true },
      ]),
    );
  });

  it("cambiar el principal conserva los adicionales", async () => {
    get.mockResolvedValue(
      usuarioCon([
        { id: 10, name: "Soporte TI" },
        { id: 12, name: "Auditor" },
      ]),
    );
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.change(
      await screen.findByRole("combobox", { name: "Rol en LaarCourier" }),
      { target: { value: "11" } },
    );
    guardar();
    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [11, 10], es_predeterminada: true },
      ]),
    );
  });

  it("el rol de cargo se muestra, no se elige, y viaja tal cual", async () => {
    get.mockResolvedValue(
      usuarioCon([
        { id: 10, name: "Soporte TI" },
        { id: 30, name: "Jefe de bodega" },
      ]),
    );
    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByText(/Por su cargo en el organigrama: Jefe de bodega/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Rol en LaarCourier" }),
    ).toHaveValue("10");
    expect(screen.queryByText("Roles adicionales")).not.toBeInTheDocument();
    guardar();
    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [30, 10], es_predeterminada: true },
      ]),
    );
  });

  it("avisa de cambios sin guardar hasta que se guardan", async () => {
    const onCambiosSinGuardar = vi.fn();
    render(
      <AsignacionEmpresas
        usuarioId="7"
        onCambiosSinGuardar={onCambiosSinGuardar}
      />,
    );

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Asignar LaarSeguridad" }),
    );
    expect(onCambiosSinGuardar).toHaveBeenLastCalledWith(true);

    guardar();

    expect(
      await screen.findByText("Empresas y roles actualizados."),
    ).toBeInTheDocument();
    expect(onCambiosSinGuardar).toHaveBeenLastCalledWith(false);
  });

  it("en una empresa no asignada no se elige rol", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    await screen.findByRole("combobox", { name: "Rol en LaarCourier" });
    expect(
      screen.queryByRole("combobox", { name: "Rol en LaarSeguridad" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Sin acceso a esta empresa/)).toBeInTheDocument();
  });

  it("al superusuario no le avisa: se salta los permisos", async () => {
    get.mockResolvedValue({ roles: [], is_superuser: true, empresas: [] });

    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Asignar LaarSeguridad" }),
    );

    expect(screen.queryByText(/Sin rol aquí/)).not.toBeInTheDocument();
  });

  it("al superusuario se le explica que no necesita roles", async () => {
    get.mockResolvedValue({ roles: [], is_superuser: true, empresas: [] });

    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByText("Superusuario (cuenta)."),
    ).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/todos los permisos/);
  });

  it("avisa si una empresa queda asignada sin ningún rol, junto al desplegable", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Asignar LaarSeguridad" }),
    );

    expect(await screen.findByText(/Sin rol aquí/)).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Rol en LaarSeguridad" }),
    ).toHaveAccessibleDescription(/Sin rol aquí/);
  });

  it("los roles globales van plegados si la cuenta no tiene ninguno", async () => {
    const { container } = render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByText(
        /Opciones avanzadas · roles en todas las empresas/,
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".empresas-asignacion__avanzado"),
    ).not.toHaveAttribute("open");
  });

  it("si la cuenta ya tiene roles globales, el bloque avanzado sale abierto", async () => {
    get.mockResolvedValue(usuarioCon([], [{ id: 11, name: "Solo consulta" }]));
    const { container } = render(<AsignacionEmpresas usuarioId="7" />);

    const grupo = await screen.findByRole("group", {
      name: "Roles en todas las empresas",
    });
    expect(await within(grupo).findByText("Solo consulta")).toBeInTheDocument();
    expect(
      container.querySelector(".empresas-asignacion__avanzado"),
    ).toHaveAttribute("open");
  });

  it("los roles globales se añaden por su propio camino", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Añadir un rol en todas las empresas",
      }),
    );
    const rol = screen.getByRole("combobox", {
      name: "Rol en todas las empresas",
    });
    // Los de cargo no son globales: el servidor los descarta.
    expect(textos(rol)).not.toContain("Jefe de bodega");
    fireEvent.change(rol, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));
    guardar();

    await waitFor(() => expect(assignRoles).toHaveBeenCalledWith("7", [10]));
  });

  it("un rol global se quita desde su ficha", async () => {
    get.mockResolvedValue(
      usuarioCon(
        [{ id: 10, name: "Soporte TI" }],
        [{ id: 11, name: "Solo consulta" }],
      ),
    );
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Quitar el rol Solo consulta en todas las empresas",
      }),
    );
    guardar();

    await waitFor(() => expect(assignRoles).toHaveBeenCalledWith("7", []));
  });

  it("sin usuarios.editar ve los globales pero no los cambia", async () => {
    permisos.delete("usuarios.editar");
    get.mockResolvedValue(usuarioCon([], [{ id: 11, name: "Solo consulta" }]));
    render(<AsignacionEmpresas usuarioId="7" />);

    const grupo = await screen.findByRole("group", {
      name: "Roles en todas las empresas",
    });
    expect(await within(grupo).findByText("Solo consulta")).toBeInTheDocument();
    expect(within(grupo).queryByRole("button")).not.toBeInTheDocument();
  });

  // AC-EMP-010: ver a quién se asignó qué no es poder cambiarlo.
  it("sin el permiso de asignar, muestra pero no deja tocar las empresas", async () => {
    permisos.delete("empresas.asignar");
    permisos.delete("usuarios.editar");

    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByRole("checkbox", { name: "Asignar LaarCourier" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Rol en LaarCourier" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Añadir otro rol" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar accesos" }),
    ).not.toBeInTheDocument();
  });

  it("sin el permiso de ver empresas no dibuja nada", async () => {
    permisos.clear();

    const { container } = render(<AsignacionEmpresas usuarioId="7" />);

    expect(container).toBeEmptyDOMElement();
    expect(list).not.toHaveBeenCalled();
  });

  // Sin `roles.ver` el catálogo no se lee, pero las empresas sí se asignan.
  it("se degrada el rol si no se puede leer el catálogo", async () => {
    listarRoles.mockRejectedValue(new Error("403"));

    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByText(/No se pudo leer el catálogo de roles/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Asignar LaarCourier" }),
    ).toBeEnabled();
    // Sigue viendo cuál tiene, aunque no lo pueda cambiar.
    const rol = screen.getByRole("combobox", { name: "Rol en LaarCourier" });
    expect(rol).toHaveValue("10");
    expect(rol).toBeDisabled();
  });

  // AC-EMP-017: con una sola empresa la asignación todavía no decide nada.
  it("con una sola empresa solo se elige el rol", async () => {
    list.mockResolvedValue({ results: [COURIER] });

    render(<AsignacionEmpresas usuarioId="7" />);

    expect(
      await screen.findByRole("heading", { name: "Roles" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rol" })).toHaveValue("10");
    expect(
      screen.queryByRole("checkbox", { name: /Asignar LaarCourier/ }),
    ).not.toBeInTheDocument();
  });

  it("no deja guardar si los accesos no cargaron (enviaría listas vacías)", async () => {
    get.mockRejectedValueOnce(new Error("caída"));
    render(<AsignacionEmpresas usuarioId="7" />);
    expect(
      await screen.findByText(/No se pudieron cargar los accesos/),
    ).toBeInTheDocument();
    const boton = screen.getByRole("button", { name: "Cargando accesos…" });
    expect(boton).toBeDisabled();
    fireEvent.click(boton);
    expect(assignEmpresas).not.toHaveBeenCalled();
    expect(assignRoles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("button", { name: "Guardar accesos" }),
    ).toBeEnabled();
  });

  // Auditoría UX/UI, 06/11/2026.
  it("mientras carga dice que carga y no pinta la lista ni el bloque avanzado", async () => {
    get.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AsignacionEmpresas usuarioId="7" />);

    expect(await screen.findByText("Cargando…")).toBeInTheDocument();
    expect(
      container.querySelector(".empresas-asignacion__lista"),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".empresas-asignacion__avanzado"),
    ).not.toBeInTheDocument();
  });

  it("«Sin rol principal» quita solo el principal y deja los adicionales", async () => {
    get.mockResolvedValue(
      usuarioCon([
        { id: 10, name: "Soporte TI" },
        { id: 12, name: "Auditor" },
      ]),
    );
    render(<AsignacionEmpresas usuarioId="7" />);

    const rol = await screen.findByRole("combobox", {
      name: "Rol en LaarCourier",
    });
    expect(textos(rol)[0]).toBe("Sin rol principal");
    fireEvent.change(rol, { target: { value: "" } });

    expect(rol).toHaveValue("");
    expect(
      within(screen.getByRole("list", { name: "Roles adicionales" })).getByText(
        "Soporte TI",
      ),
    ).toBeInTheDocument();
    guardar();
    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [10], es_predeterminada: true },
      ]),
    );
  });

  it("anuncia cada cambio al lector de pantalla, sin guardar", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.change(
      await screen.findByRole("combobox", { name: "Rol en LaarCourier" }),
      { target: { value: "11" } },
    );

    expect(
      screen.getByText(
        "Rol Solo consulta elegido en LaarCourier; sin guardar.",
      ),
    ).toHaveAttribute("role", "status");
  });

  it("Escape cierra el panel de otro rol desde cualquiera de sus controles", async () => {
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Añadir otro rol" }),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancelar" }), {
      key: "Escape",
    });

    expect(
      screen.queryByRole("combobox", { name: "Otro rol en LaarCourier" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Añadir otro rol" }),
      ).toHaveFocus(),
    );
  });

  it("si añade la última opción, el foco va a la ficha recién añadida", async () => {
    get.mockResolvedValue(
      usuarioCon([
        { id: 10, name: "Soporte TI" },
        { id: 11, name: "Solo consulta" },
      ]),
    );
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Añadir otro rol" }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Otro rol en LaarCourier" }),
      { target: { value: "12" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Quitar el rol Auditor en LaarCourier",
        }),
      ).toHaveFocus(),
    );
  });

  it("al quitar el último rol global, el foco no se pierde", async () => {
    get.mockResolvedValue(
      usuarioCon(
        [{ id: 10, name: "Soporte TI" }],
        [{ id: 11, name: "Solo consulta" }],
      ),
    );
    render(<AsignacionEmpresas usuarioId="7" />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Quitar el rol Solo consulta en todas las empresas",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Añadir un rol en todas las empresas",
        }),
      ).toHaveFocus(),
    );
  });
});

/* Con una sola empresa no puede haber dos sitios donde mirar el rol: era la
   queja original (auditoría UX/UI, 06/11/2026). */
describe("Rol con una sola empresa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.clear();
    permisos.add("empresas.ver");
    permisos.add("empresas.asignar");
    permisos.add("usuarios.editar");
    list.mockResolvedValue({ results: [COURIER] });
    listarRoles.mockResolvedValue(ROLES);
  });

  it("si su rol es global lo dice bajo el desplegable y lo pasa a la empresa", async () => {
    get.mockResolvedValue(usuarioCon([], [{ id: 11, name: "Solo consulta" }]));
    const { container } = render(<AsignacionEmpresas usuarioId="7" />);

    const rol = await screen.findByRole("combobox", { name: "Rol" });
    expect(rol).toHaveValue("");
    // Solo la frase, sin el texto del botón.
    expect(rol.getAttribute("aria-describedby")).toContain("rol-1-global-11");
    expect(document.getElementById("rol-1-global-11")).toHaveTextContent(
      /^Ya tiene Solo consulta en todas las empresas\.$/,
    );
    expect(rol).not.toHaveAccessibleDescription(/Pasarlo/);
    // Ya se nombra bajo el desplegable: el bloque avanzado no se abre solo.
    expect(
      container.querySelector(".empresas-asignacion__avanzado"),
    ).not.toHaveAttribute("open");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Pasarlo a rol de la empresa (Solo consulta)",
      }),
    );
    expect(rol).toHaveValue("11");
    expect(
      screen.queryByText(/Ya tiene Solo consulta/),
    ).not.toBeInTheDocument();

    guardar();
    await waitFor(() =>
      expect(assignEmpresas).toHaveBeenCalledWith("7", [
        { empresa_id: 1, roles: [11], es_predeterminada: true },
      ]),
    );
    expect(assignRoles).toHaveBeenCalledWith("7", []);
  });

  it("sin globales no muestra las opciones avanzadas", async () => {
    get.mockResolvedValue(usuarioCon([{ id: 10, name: "Soporte TI" }]));
    render(<AsignacionEmpresas usuarioId="7" />);

    await screen.findByRole("combobox", { name: "Rol" });
    expect(screen.queryByText(/Opciones avanzadas/)).not.toBeInTheDocument();
  });

  it("al superusuario se las ofrece como enlace discreto", async () => {
    const { AuthContext } = await import("../src/context/AuthContext");
    get.mockResolvedValue(usuarioCon([{ id: 10, name: "Soporte TI" }]));
    const { container } = render(
      <AuthContext.Provider value={{ user: { is_superuser: true } }}>
        <AsignacionEmpresas usuarioId="7" />
      </AuthContext.Provider>,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Opciones avanzadas · roles en todas las empresas",
      }),
    );

    expect(
      container.querySelector(".empresas-asignacion__avanzado"),
    ).toHaveAttribute("open");
    expect(
      screen.getByRole("group", { name: "Roles en todas las empresas" }),
    ).toBeInTheDocument();
  });
});
