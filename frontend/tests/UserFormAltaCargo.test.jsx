import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Alta de usuario con su cargo del organigrama (09/11/2026).
 *
 * Queja: «al crear un nuevo usuario, en el desplegable de Rol no veo Jefe de
 * Cartera». Los roles de cargo no se eligen a mano: los recibe quien ocupa el
 * cargo. Por eso el alta pregunta por el cargo (solo a quien puede asignar
 * cargos), dice qué rol da, deja el rol manual como opcional y, al crear,
 * pone la cuenta en el cargo. Si eso falla, la cuenta ya existe: se va a su
 * ficha y se avisa de que falta el cargo.
 */

const COURIER = { id: 1, nombre: "LaarCourier", codigo: "LC", activa: true };
const SEGURIDAD = {
  id: 3,
  nombre: "LaarSeguridad",
  codigo: "LS",
  activa: true,
};
const ROLES = [
  { id: 10, name: "Soporte TI" },
  {
    id: 90,
    name: "Jefe de Cartera · Cartera",
    cargo: { id: 50, nombre: "Jefe de Cartera" },
  },
];
const ORGANIGRAMA = {
  unidades: [
    { id: 1, nombre: "Cartera" },
    { id: 2, nombre: "Tecnología" },
  ],
  cargos: [
    {
      id: 50,
      nombre: "Jefe de Cartera",
      unidad: 1,
      jefe: null,
      activo: true,
      vacantes: 0,
      rol: { id: 90, nombre: "Jefe de Cartera · Cartera" },
      ocupantes: [
        {
          id: "sin-cuenta-1",
          nombre: "Sara Fernanda Marroquín García",
          sin_cuenta: true,
        },
      ],
    },
    {
      id: 51,
      nombre: "Analista de Cartera",
      unidad: 1,
      jefe: 50,
      activo: true,
      vacantes: 2,
      rol: { id: 91, nombre: "Analista de Cartera" },
      ocupantes: [],
    },
    {
      id: 53,
      nombre: "Asistente del Jefe de Cartera",
      unidad: 1,
      jefe: 50,
      activo: true,
      vacantes: 1,
      rol: null,
      ocupantes: [],
    },
    {
      id: 52,
      nombre: "Cargo retirado",
      unidad: 2,
      jefe: null,
      activo: false,
      vacantes: 1,
      rol: null,
      ocupantes: [],
    },
  ],
};

const listarEmpresas = vi.fn();
const misEmpresas = vi.fn();
const listarRoles = vi.fn();
const crear = vi.fn();
const obtener = vi.fn();
const organigrama = vi.fn();
const asignar = vi.fn();

vi.mock("../src/api/empresasService", () => ({
  empresasService: {
    list: (...args) => listarEmpresas(...args),
    mias: (...args) => misEmpresas(...args),
  },
}));
vi.mock("../src/api/rolesService", () => ({
  rolesService: { list: (...args) => listarRoles(...args) },
}));
vi.mock("../src/api/adminUsersService", () => ({
  adminUsersService: {
    create: (...args) => crear(...args),
    get: (...args) => obtener(...args),
    // US-018: la tarjeta «Mientras no está» de la ficha.
    reemplazo: () =>
      Promise.resolve({
        modo: "jefe",
        persona: null,
        jefe: null,
        ausencia: null,
      }),
    guardarReemplazo: () => Promise.resolve({}),
  },
}));
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: {
    organigrama: (...args) => organigrama(...args),
    asignar: (...args) => asignar(...args),
  },
}));
vi.mock("../src/api/client", () => ({ getEmpresaActiva: () => "3" }));
vi.mock("../src/context/UnsavedChangesContext", () => ({
  useUnsavedChanges: () => ({ setIsDirty: vi.fn(), guardedNavigate: vi.fn() }),
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { UserForm } = await import("../src/pages/Admin/Users/UserForm");

function pintar() {
  return render(
    <MemoryRouter initialEntries={["/admin/users/new"]}>
      <Routes>
        <Route path="/admin/users/new" element={<UserForm />} />
        <Route path="/admin/users/:id" element={<UserForm />} />
      </Routes>
    </MemoryRouter>,
  );
}

function escribir(etiqueta, valor) {
  fireEvent.change(screen.getByLabelText(etiqueta), {
    target: { value: valor },
  });
}

function rellenar(nombres = "Nueva", apellidos = "Peñarreta") {
  escribir(/^Nombres/, nombres);
  escribir(/^Apellidos/, apellidos);
  escribir(/^Correo/, "nueva@example.com");
  escribir(/Contraseña inicial/, "Sup3r-Secr3t!");
}

async function elegirCargo(nombre) {
  fireEvent.click(await screen.findByRole("radio", { name: nombre }));
}

describe("Alta de usuario con cargo del organigrama", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.clear();
    permisos.add("empresas.asignar");
    permisos.add("institucional.asignar");
    listarEmpresas.mockResolvedValue({ results: [COURIER, SEGURIDAD] });
    misEmpresas.mockResolvedValue({
      empresas: [COURIER, SEGURIDAD],
      activa: SEGURIDAD,
      multiempresa: true,
    });
    listarRoles.mockResolvedValue(ROLES);
    organigrama.mockResolvedValue(ORGANIGRAMA);
    crear.mockResolvedValue({ id: 7 });
    asignar.mockResolvedValue({ usuario: 7, cargo: 50 });
    obtener.mockResolvedValue({
      id: 7,
      username: "npenarreta",
      email: "nueva@example.com",
      first_name: "Nueva",
      last_name: "Peñarreta",
      codigo_empleado: null,
    });
  });

  it("sin permiso de asignar cargos no se pregunta el cargo", async () => {
    permisos.delete("institucional.asignar");
    pintar();

    await screen.findByRole("option", { name: "Soporte TI" });
    expect(screen.queryByLabelText("Buscar cargo")).not.toBeInTheDocument();
    expect(organigrama).not.toHaveBeenCalled();
    // Y el rol sigue obligatorio, con la ayuda de siempre.
    expect(screen.getByLabelText(/^Rol/)).toHaveAttribute(
      "aria-required",
      "true",
    );
  });

  it("ofrece los cargos activos de la empresa elegida, con sus vacantes", async () => {
    pintar();

    expect(await screen.findByLabelText("Buscar cargo")).toBeInTheDocument();
    await waitFor(() =>
      expect(organigrama).toHaveBeenCalledWith({ empresa: 3 }),
    );
    expect(
      await screen.findByRole("radio", {
        name: "Jefe de Cartera · Cartera · sin vacantes",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", {
        name: "Analista de Cartera · Cartera · 2 vacantes",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Cargo retirado/)).not.toBeInTheDocument();
    // El combobox Rol explica de dónde salen los roles de cargo.
    expect(
      screen.getByText(
        /Los roles de un cargo \(p\. ej\. Jefe de Cartera\) se dan eligiendo el cargo arriba\./,
      ),
    ).toBeInTheDocument();
  });

  it("el buscador filtra sin tildes ni mayúsculas", async () => {
    pintar();

    await screen.findByRole("radio", { name: /^Jefe de Cartera/ });
    escribir("Buscar cargo", "ANALISTA");

    expect(await screen.findByText("1 cargo encontrado.")).toBeInTheDocument();
    expect(
      screen.queryByRole("radio", { name: /^Jefe de Cartera/ }),
    ).not.toBeInTheDocument();
  });

  it("los que empiezan por lo buscado van primero; y marca los sin rol", async () => {
    pintar();

    await screen.findByRole("radio", { name: /^Jefe de Cartera/ });
    escribir("Buscar cargo", "jefe de cartera");

    await screen.findByText("2 cargos encontrados.");
    const opciones = screen.getAllByRole("radio");
    expect(opciones.map((o) => o.closest("label").textContent)).toEqual([
      "Jefe de Cartera · Cartera · sin vacantes",
      "Asistente del Jefe de Cartera · Cartera · 1 vacante · sin rol",
    ]);
  });

  it("al elegir un cargo, el rol pasa a opcional y se dice qué rol da", async () => {
    pintar();

    await elegirCargo(/^Jefe de Cartera/);

    const rol = screen.getByLabelText(/^Rol adicional \(opcional\)/);
    expect(rol).not.toHaveAttribute("aria-required");
    expect(
      screen.getByText(
        "Recibe el rol «Jefe de Cartera · Cartera» y sus permisos.",
      ),
    ).toBeInTheDocument();
    // Y sin rol manual ya no se exige nada.
    rellenar();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));
    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(screen.queryByText(/^Elija un rol/)).not.toBeInTheDocument();
  });

  it("sin rol ni cargo, el error dice que vale cualquiera de los dos", async () => {
    pintar();

    await screen.findByRole("radio", { name: /^Jefe de Cartera/ });
    rellenar();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    expect(
      await screen.findByText(
        "Elija un rol o, si ocupa un cargo, el cargo del organigrama.",
      ),
    ).toBeInTheDocument();
    expect(crear).not.toHaveBeenCalled();
  });

  it("anuncia la elección, el rol y cada aviso en una región viva", async () => {
    pintar();
    const region = (await screen.findByText(/cargos encontrados/))
      .closest("fieldset")
      .querySelector("p.visually-hidden[role='status']");
    // Montada desde el principio y vacía.
    expect(region).toBeInTheDocument();
    expect(region.textContent).toBe("");

    await elegirCargo(/^Jefe de Cartera/);
    expect(region).toHaveTextContent(
      "Elegido: Jefe de Cartera · Cartera. Recibe el rol «Jefe de Cartera · Cartera» y sus permisos. El cargo no tiene vacantes",
    );

    // Lo que se escribe en Nombres y Apellidos también se anuncia.
    rellenar("Sara Fernanda", "Marroquin  GARCIA");
    expect(region).toHaveTextContent(
      "figura «Sara Fernanda Marroquín García» sin cuenta: se reemplazará",
    );
    // Y el aviso visible no es otra región: se leería dos veces.
    const visible = screen.getByText(
      /^En este cargo figura «Sara Fernanda Marroquín García» sin cuenta: se reemplazará/,
    );
    expect(visible.closest("[role]")).toBeNull();

    // Parecido pero no igual: el servidor no lo toca, y se dice.
    rellenar("Sara", "Marroquín");
    expect(region).toHaveTextContent(
      "Si es la misma persona, escriba los nombres y apellidos igual",
    );
  });

  it("crea la cuenta sin rol manual y después la pone en el cargo", async () => {
    pintar();
    await elegirCargo(/^Jefe de Cartera/);
    rellenar();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() => expect(asignar).toHaveBeenCalled());
    expect(crear).toHaveBeenCalledWith(
      expect.objectContaining({
        empresas: [{ empresa_id: 3, roles: [], es_predeterminada: true }],
      }),
    );
    expect(asignar).toHaveBeenCalledWith(
      7,
      50,
      "Alta de la cuenta de Nueva Peñarreta: ocupa el cargo Jefe de Cartera · Cartera",
      { empresa: 3 },
    );
    // Primero la cuenta, luego el cargo: sin cuenta no hay a quién asignar.
    expect(crear.mock.invocationCallOrder[0]).toBeLessThan(
      asignar.mock.invocationCallOrder[0],
    );
    // En su ficha, el resultado, dentro de una región viva.
    const exito = await screen.findByText(
      "Cuenta creada en el cargo Jefe de Cartera · Cartera: ya tiene el rol Jefe de Cartera · Cartera.",
    );
    expect(exito.closest("[role='status']")).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Editar usuario" }),
    ).toBeInTheDocument();
  });

  it("con cargo y rol adicional manda los dos", async () => {
    pintar();
    await elegirCargo(/^Analista de Cartera/);
    await screen.findByRole("option", { name: "Soporte TI" });
    escribir(/^Rol adicional/, "10");
    rellenar();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    await waitFor(() => expect(asignar).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].empresas).toEqual([
      { empresa_id: 3, roles: [10], es_predeterminada: true },
    ]);
    expect(asignar.mock.calls[0][1]).toBe(51);
  });

  it("si el cargo no se asigna, va a la ficha y avisa que falta", async () => {
    asignar.mockRejectedValue({
      response: {
        data: { error: { message: "No tiene el permiso requerido." } },
      },
    });
    pintar();
    await elegirCargo(/^Jefe de Cartera/);
    rellenar();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(
      "La cuenta se creó, pero no se pudo asignar el cargo Jefe de Cartera · Cartera en la empresa LaarSeguridad (No tiene el permiso requerido).",
    );
    // La de la pestaña: navega dentro de la aplicación, ya filtrada.
    expect(
      screen.getByRole("link", { name: "Ir a Asignación de cargos" }),
    ).toHaveAttribute(
      "href",
      `/admin/institucional/estructura?pestana=asignaciones&buscar=${encodeURIComponent("Nueva Peñarreta")}`,
    );
    expect(
      screen.getByRole("heading", { name: "Editar usuario" }),
    ).toBeInTheDocument();
  });

  it("si falla en otra empresa, lo dice y el enlace abre esa empresa", async () => {
    asignar.mockRejectedValue(new Error("caído"));
    pintar();
    await screen.findByRole("radio", { name: /^Jefe de Cartera/ });
    escribir(/^Empresa/, "1");
    await waitFor(() =>
      expect(organigrama).toHaveBeenLastCalledWith({ empresa: 1 }),
    );
    await elegirCargo(/^Jefe de Cartera/);
    rellenar();
    fireEvent.click(screen.getByRole("button", { name: "Crear usuario" }));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent("en la empresa LaarCourier");
    expect(aviso).toHaveTextContent("Asignación de cargos de LaarCourier");
    expect(
      screen.getByRole("link", { name: "Ir a Asignación de cargos" }),
    ).toHaveAttribute(
      "href",
      `/admin/institucional/estructura?pestana=asignaciones&buscar=${encodeURIComponent("Nueva Peñarreta")}&empresa=1`,
    );
  });

  it("en una empresa en la que no trabaja no ofrece cargos: lo explica", async () => {
    misEmpresas.mockResolvedValue({
      empresas: [SEGURIDAD],
      activa: SEGURIDAD,
      multiempresa: true,
    });
    pintar();
    await screen.findByRole("radio", { name: /^Jefe de Cartera/ });

    escribir(/^Empresa/, "1");

    expect(
      await screen.findByText(/No tiene acceso al organigrama de esta empresa/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Buscar cargo")).not.toBeInTheDocument();
    expect(organigrama).not.toHaveBeenCalledWith({ empresa: 1 });
    // Sin cargo posible, el rol vuelve a ser obligatorio y la ayuda no
    // manda a elegir un cargo «arriba».
    expect(screen.getByLabelText(/^Rol/)).toHaveAttribute(
      "aria-required",
      "true",
    );
    expect(
      screen.queryByText(/se dan eligiendo el cargo arriba/),
    ).not.toBeInTheDocument();
  });

  it("con una sola empresa titula «Cargo y rol»", async () => {
    listarEmpresas.mockResolvedValue({ results: [SEGURIDAD] });
    misEmpresas.mockResolvedValue({
      empresas: [SEGURIDAD],
      activa: SEGURIDAD,
      multiempresa: false,
    });
    pintar();

    expect(
      await screen.findByRole("heading", { name: "Cargo y rol" }),
    ).toBeInTheDocument();
  });

  it("cambiar de empresa borra el cargo y pide los cargos de la nueva", async () => {
    pintar();
    await elegirCargo(/^Jefe de Cartera/);
    expect(screen.getByText(/^Recibe el rol/)).toBeInTheDocument();

    escribir(/^Empresa/, "1");

    await waitFor(() =>
      expect(organigrama).toHaveBeenLastCalledWith({ empresa: 1 }),
    );
    expect(screen.queryByText(/^Recibe el rol/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Rol/)).toHaveAttribute(
      "aria-required",
      "true",
    );
  });

  it("si los cargos no cargan, lo dice y deja reintentar", async () => {
    organigrama.mockRejectedValueOnce(new Error("caído"));
    pintar();

    expect(
      await screen.findByText(
        "No se pudieron cargar los cargos del organigrama.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("radio", { name: /^Jefe de Cartera/ }),
    ).toBeInTheDocument();
  });
});
