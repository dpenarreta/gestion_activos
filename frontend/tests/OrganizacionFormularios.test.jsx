import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Los formularios de los catálogos de la organización.
 *
 * Los cuatro siguen el mismo trato: se abren para consultar aunque no se pueda
 * editar (los campos quedan bloqueados y no hay botón de guardar), y al
 * guardar distinguen alta de edición. Encima de eso, dos de ellos adelantan
 * una regla que el backend impone —no se desactiva a quien todavía custodia
 * equipos, ni se cierra una sede que todavía los contiene—: decirlo aquí evita
 * que el usuario la descubra recién al guardar.
 */

const servicio = {
  sedes: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
  departamentos: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  },
  empleados: { get: vi.fn(), create: vi.fn(), update: vi.fn(), list: vi.fn() },
  proveedores: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
};

vi.mock("../src/api/organizacionService", () => ({
  sedesService: servicio.sedes,
  departamentosService: servicio.departamentos,
  empleadosService: servicio.empleados,
  proveedoresService: servicio.proveedores,
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const { SedeForm } = await import("../src/pages/Admin/Organizacion/SedeForm");
const { DepartamentoForm } =
  await import("../src/pages/Admin/Organizacion/DepartamentoForm");
const { EmpleadoForm } =
  await import("../src/pages/Admin/Organizacion/EmpleadoForm");
const { ProveedorForm } =
  await import("../src/pages/Admin/Organizacion/ProveedorForm");

/** Deja ver a dónde vuelve el formulario tras guardar. */
function Destino() {
  return <p>Destino: {useLocation().pathname}</p>;
}

function pintar(Pantalla, base, id = null) {
  return render(
    <MemoryRouter initialEntries={[id ? `${base}/${id}` : `${base}/new`]}>
      <Routes>
        <Route path={`${base}/new`} element={<Pantalla />} />
        <Route path={`${base}/:id`} element={<Pantalla />} />
        <Route path="*" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

/* Los cuatro formularios, con el mínimo que hace falta para guardarlos. */
const FORMULARIOS = [
  {
    titulo: "Sede",
    Pantalla: SedeForm,
    base: "/admin/organizacion/sedes",
    servicio: "sedes",
    tituloAlta: "Nueva sede",
    tituloEdicion: "Editar sede",
    errorCarga: "No se pudo cargar la sede.",
    errorGuardado: "No se pudo guardar la sede.",
    registro: {
      id: 1,
      nombre: "Matriz Quito",
      ciudad: "Quito",
      direccion: "Av. Amazonas",
      activa: true,
      total_activos: 0,
    },
    campoPrincipal: "Nombre",
    llenar: () => {
      fireEvent.change(screen.getByLabelText("Nombre"), {
        target: { value: "Bodega Sur" },
      });
      fireEvent.change(screen.getByLabelText("Ciudad"), {
        target: { value: "Quito" },
      });
    },
    esperado: { nombre: "Bodega Sur", ciudad: "Quito" },
  },
  {
    titulo: "Departamento",
    Pantalla: DepartamentoForm,
    base: "/admin/organizacion/departamentos",
    servicio: "departamentos",
    tituloAlta: "Nuevo departamento",
    tituloEdicion: "Editar departamento",
    errorCarga: "No se pudo cargar el departamento.",
    errorGuardado: "No se pudo guardar el departamento.",
    registro: {
      id: 2,
      nombre: "Tecnología",
      codigo: "TEC",
      descripcion: "",
      responsable: null,
      activo: true,
    },
    campoPrincipal: "Nombre",
    llenar: () => {
      fireEvent.change(screen.getByLabelText("Nombre"), {
        target: { value: "Contabilidad" },
      });
      fireEvent.change(screen.getByLabelText(/Código/), {
        target: { value: "CON" },
      });
    },
    esperado: { nombre: "Contabilidad", codigo: "CON" },
  },
  {
    titulo: "Empleado",
    Pantalla: EmpleadoForm,
    base: "/admin/organizacion/empleados",
    servicio: "empleados",
    tituloAlta: "Nuevo empleado",
    tituloEdicion: "Editar empleado",
    errorCarga: "No se pudo cargar el empleado.",
    errorGuardado: "No se pudo guardar el empleado.",
    registro: {
      id: 3,
      nombres: "Luis",
      apellidos: "Mora",
      codigo_empleado: "EMP-0003",
      correo: "",
      telefono: "",
      cargo: "Analista",
      departamento: 2,
      activo: true,
      total_activos: 0,
    },
    campoPrincipal: "Nombres",
    llenar: () => {
      fireEvent.change(screen.getByLabelText("Nombres"), {
        target: { value: "Ana" },
      });
      fireEvent.change(screen.getByLabelText("Apellidos"), {
        target: { value: "Cevallos" },
      });
      fireEvent.change(screen.getByLabelText("Departamento"), {
        target: { value: "2" },
      });
    },
    esperado: { nombres: "Ana", apellidos: "Cevallos", departamento: "2" },
  },
  {
    titulo: "Proveedor",
    Pantalla: ProveedorForm,
    base: "/admin/organizacion/proveedores",
    servicio: "proveedores",
    tituloAlta: "Nuevo proveedor",
    tituloEdicion: "Editar proveedor",
    errorCarga: "No se pudo cargar el proveedor.",
    errorGuardado: "No se pudo guardar el proveedor.",
    registro: {
      id: 4,
      nombre: "Tecnomega C.A.",
      identificacion: "0991234567001",
      contacto: "Paola Vaca",
      telefono: "0999999999",
      correo: "",
      observaciones: "",
      activo: true,
      total_activos: 0,
    },
    campoPrincipal: "Nombre",
    llenar: () => {
      fireEvent.change(screen.getByLabelText("Nombre"), {
        target: { value: "Compumundo" },
      });
    },
    esperado: { nombre: "Compumundo" },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  for (const api of Object.values(servicio)) {
    api.create.mockResolvedValue({ id: 99 });
    api.update.mockResolvedValue({ id: 99 });
    api.list?.mockResolvedValue({ results: [] });
  }
  servicio.departamentos.list.mockResolvedValue({
    results: [{ id: 2, nombre: "Tecnología" }],
  });
  servicio.empleados.list.mockResolvedValue({
    results: [{ id: 3, nombre_completo: "Luis Mora" }],
  });
});

// --- El trato común ---------------------------------------------------------

describe.each(FORMULARIOS)(
  "$titulo",
  ({
    Pantalla,
    base,
    servicio: clave,
    tituloAlta,
    tituloEdicion,
    errorCarga,
    errorGuardado,
    registro,
    campoPrincipal,
    llenar,
    esperado,
  }) => {
    it("sin permiso se consulta, pero no se puede cambiar nada", async () => {
      /* El catálogo se consulta más de lo que se cambia. Un formulario que se
         puede llenar y luego rechaza el guardado hace perder el trabajo. */
      servicio[clave].get.mockResolvedValue(registro);

      pintar(Pantalla, base, registro.id);

      await screen.findByText(tituloEdicion);
      expect(screen.getByLabelText(campoPrincipal)).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: "Guardar" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Volver" }),
      ).toBeInTheDocument();
    });

    it("con permiso, el alta crea y no toca nada existente", async () => {
      permisos.add("organizacion.editar");

      pintar(Pantalla, base);

      await screen.findByText(tituloAlta);
      llenar();
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() => expect(servicio[clave].create).toHaveBeenCalled());
      expect(servicio[clave].create.mock.calls[0][0]).toMatchObject(esperado);
      expect(servicio[clave].update).not.toHaveBeenCalled();
    });

    it("editar guarda sobre el registro abierto, no crea otro", async () => {
      permisos.add("organizacion.editar");
      servicio[clave].get.mockResolvedValue(registro);

      pintar(Pantalla, base, registro.id);

      await screen.findByText(tituloEdicion);
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() => expect(servicio[clave].update).toHaveBeenCalled());
      expect(servicio[clave].update.mock.calls[0][0]).toBe(String(registro.id));
      expect(servicio[clave].create).not.toHaveBeenCalled();
    });

    it("guardado, vuelve al listado", async () => {
      permisos.add("organizacion.editar");

      pintar(Pantalla, base);

      await screen.findByText(tituloAlta);
      llenar();
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

      expect(await screen.findByText(`Destino: ${base}`)).toBeInTheDocument();
    });

    it("si el servidor rechaza el guardado, lo dice con su motivo", async () => {
      permisos.add("organizacion.editar");
      servicio[clave].create.mockRejectedValue({
        response: {
          data: { error: { message: "Ya existe uno con ese nombre." } },
        },
      });

      pintar(Pantalla, base);

      await screen.findByText(tituloAlta);
      llenar();
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

      expect(
        await screen.findByText("Ya existe uno con ese nombre."),
      ).toBeInTheDocument();
    });

    it("y sin motivo, uno genérico en vez del silencio", async () => {
      permisos.add("organizacion.editar");
      servicio[clave].create.mockRejectedValue(new Error("network"));

      pintar(Pantalla, base);

      await screen.findByText(tituloAlta);
      llenar();
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

      expect(await screen.findByText(errorGuardado)).toBeInTheDocument();
    });

    it("si el registro no carga, lo dice", async () => {
      servicio[clave].get.mockRejectedValue(new Error("404"));

      pintar(Pantalla, base, registro.id);

      expect(await screen.findByText(errorCarga)).toBeInTheDocument();
    });
  },
);

// --- Las reglas que se adelantan --------------------------------------------

describe("Lo que el formulario advierte antes de intentarlo", () => {
  it("no se desactiva a un empleado que todavía custodia equipos", async () => {
    /* El backend lo rechaza. Decirlo al desmarcar la casilla —y no al
       guardar— es la diferencia entre corregirlo y volver a empezar. */
    permisos.add("organizacion.editar");
    servicio.empleados.get.mockResolvedValue({
      id: 3,
      nombres: "Luis",
      apellidos: "Mora",
      codigo_empleado: "EMP-0003",
      correo: "",
      telefono: "",
      cargo: "Analista",
      departamento: 2,
      activo: true,
      total_activos: 4,
    });

    pintar(EmpleadoForm, "/admin/organizacion/empleados", 3);

    await screen.findByText("Editar empleado");
    expect(
      screen.getByText(/Custodia actualmente 4 activo/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Empleado activo"));

    expect(
      screen.getByText(/Reasígnelos antes de desactivarlo/),
    ).toBeInTheDocument();
  });

  it("sin equipos a cargo, desactivarlo no advierte nada", async () => {
    permisos.add("organizacion.editar");
    servicio.empleados.get.mockResolvedValue({
      id: 3,
      nombres: "Luis",
      apellidos: "Mora",
      codigo_empleado: "EMP-0003",
      correo: "",
      telefono: "",
      cargo: "",
      departamento: 2,
      activo: true,
      total_activos: 0,
    });

    pintar(EmpleadoForm, "/admin/organizacion/empleados", 3);

    await screen.findByText("Editar empleado");
    fireEvent.click(screen.getByLabelText("Empleado activo"));

    expect(screen.queryByText(/Reasígnelos/)).not.toBeInTheDocument();
  });

  it("el código de empleado se genera solo si se deja vacío", async () => {
    permisos.add("organizacion.editar");

    pintar(EmpleadoForm, "/admin/organizacion/empleados");

    await screen.findByText("Nuevo empleado");
    expect(
      screen.getByPlaceholderText("Se genera solo (EMP-0001)"),
    ).toBeInTheDocument();
  });

  it("una sede con equipos dentro dice que hay que moverlos antes de cerrarla", async () => {
    permisos.add("organizacion.editar");
    servicio.sedes.get.mockResolvedValue({
      id: 1,
      nombre: "Matriz Quito",
      ciudad: "Quito",
      direccion: "",
      activa: true,
      total_activos: 12,
    });

    pintar(SedeForm, "/admin/organizacion/sedes", 1);

    expect(
      await screen.findByText(/Hay 12 activo\(s\) aquí/),
    ).toBeInTheDocument();
  });

  it("la ciudad es obligatoria: es lo que se lee al preguntar dónde está un equipo", async () => {
    /* El nombre interno de la sede no le dice nada a quien tiene que ir a
       buscarlo. */
    permisos.add("organizacion.editar");

    pintar(SedeForm, "/admin/organizacion/sedes");

    await screen.findByText("Nueva sede");
    expect(screen.getByLabelText("Ciudad")).toBeRequired();
  });

  it("el departamento puede quedarse sin responsable asignado", async () => {
    permisos.add("organizacion.editar");

    pintar(DepartamentoForm, "/admin/organizacion/departamentos");

    await screen.findByText("Nuevo departamento");
    expect(
      await screen.findByRole("option", { name: "Sin responsable asignado" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Responsable del área")).not.toBeRequired();
  });

  it("el proveedor lleva el RUC y a quién llamar cuando algo falla", async () => {
    permisos.add("organizacion.editar");

    pintar(ProveedorForm, "/admin/organizacion/proveedores");

    await screen.findByText("Nuevo proveedor");
    expect(
      screen.getByText("RUC o identificación tributaria."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A quién llamar cuando un equipo o una pieza falla/),
    ).toBeInTheDocument();
  });
});
