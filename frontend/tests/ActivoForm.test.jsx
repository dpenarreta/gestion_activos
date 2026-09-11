import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El alta y la edición de la ficha técnica.
 *
 * Es donde entra todo lo que después se consulta, así que lo que importa no
 * son los campos sino las tres decisiones que el formulario toma por su
 * cuenta: qué se pregunta según el tipo elegido (cada tipo declara sus
 * características), qué catálogos ofrece (solo lo vigente: una sede cerrada o
 * un proveedor de baja dejarían el equipo registrado contra algo que ya no
 * existe) y qué deja de poderse cambiar al editar —custodio y departamento se
 * mueven por la acción de asignación, que deja rastro en el historial—.
 */

const obtener = vi.fn();
const crear = vi.fn();
const actualizar = vi.fn();
const listarTipos = vi.fn();
const caracteristicasDelTipo = vi.fn();
const listarDepartamentos = vi.fn();
const listarEmpleados = vi.fn();
const listarSedes = vi.fn();
const listarProveedores = vi.fn();
const listarConcesionarios = vi.fn();

vi.mock("../src/api/activosService", () => ({
  activosService: {
    get: (...args) => obtener(...args),
    create: (...args) => crear(...args),
    update: (...args) => actualizar(...args),
  },
  tiposDispositivoService: { list: (...args) => listarTipos(...args) },
  caracteristicasService: {
    delTipo: (...args) => caracteristicasDelTipo(...args),
  },
}));

vi.mock("../src/api/organizacionService", () => ({
  departamentosService: { list: (...args) => listarDepartamentos(...args) },
  empleadosService: { list: (...args) => listarEmpleados(...args) },
  sedesService: { list: (...args) => listarSedes(...args) },
  proveedoresService: { list: (...args) => listarProveedores(...args) },
  concesionariosService: { list: (...args) => listarConcesionarios(...args) },
}));

const { ActivoForm } = await import("../src/pages/Admin/Activos/ActivoForm");

const ACTIVO = {
  id: 7,
  tipo: 1,
  nombre: "Laptop Jefatura TI",
  marca: "Dell",
  modelo: "Latitude 5440",
  numero_serie: "DL5440-0011",
  especificaciones: { RAM: 16 },
  observaciones: "",
  custodio: 3,
  departamento: 2,
  sede: 4,
  criticidad: "alta",
  uso: "gerencial",
  fecha_adquisicion: "2025-07-01",
  fecha_ingreso: "2025-07-15",
  costo_adquisicion: "1180.00",
  proveedor: 5,
  fecha_fin_garantia: "2027-07-01",
};

/** Deja ver a dónde navegó el formulario tras guardar. */
function Destino() {
  return <p>Destino: {useLocation().pathname}</p>;
}

function pintar(id = null) {
  return render(
    <MemoryRouter
      initialEntries={[
        id ? `/admin/activos/${id}/editar` : "/admin/activos/new",
      ]}
    >
      <Routes>
        <Route path="/admin/activos/new" element={<ActivoForm />} />
        <Route path="/admin/activos/:id/editar" element={<ActivoForm />} />
        <Route path="*" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Llena lo obligatorio de un alta. */
function llenarMinimo() {
  fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("Nombre del activo"), {
    target: { value: "Laptop Contabilidad 02" },
  });
  fireEvent.change(screen.getByLabelText("Marca"), {
    target: { value: "HP" },
  });
  fireEvent.change(screen.getByLabelText("Modelo"), {
    target: { value: "ProBook 450" },
  });
  fireEvent.change(screen.getByLabelText("Número de serie"), {
    target: { value: "HP450-0033" },
  });
  fireEvent.change(screen.getByLabelText("Departamento"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Fecha de adquisición"), {
    target: { value: "2026-03-01" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listarTipos.mockResolvedValue({
    results: [
      { id: 1, nombre: "Laptop", codigo: "LAP", activo: true },
      { id: 9, nombre: "Fax", codigo: "FAX", activo: false },
    ],
  });
  caracteristicasDelTipo.mockResolvedValue([]);
  listarDepartamentos.mockResolvedValue({
    results: [{ id: 2, nombre: "Tecnología" }],
  });
  listarEmpleados.mockResolvedValue({
    results: [{ id: 3, nombre_completo: "Luis Mora" }],
  });
  listarSedes.mockResolvedValue({
    results: [{ id: 4, nombre: "Matriz", ciudad: "Quito" }],
  });
  listarProveedores.mockResolvedValue({
    results: [{ id: 5, nombre: "Tecnomega C.A." }],
  });
  listarConcesionarios.mockResolvedValue({
    results: [{ id: 6, nombre: "Servientrega Andina" }],
  });
  crear.mockResolvedValue({ id: 42 });
  actualizar.mockResolvedValue({ id: 7 });
  obtener.mockResolvedValue(ACTIVO);
});

// --- Qué se ofrece ----------------------------------------------------------

describe("Los catálogos que ofrece el alta", () => {
  it("solo tipos de dispositivo vigentes", async () => {
    /* Un tipo descontinuado no debe recibir equipos nuevos; su código de
       barras seguiría generándose como si el tipo siguiera en uso. */
    pintar();

    expect(
      await screen.findByRole("option", { name: "Laptop (LAP)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Fax/ }),
    ).not.toBeInTheDocument();
  });

  it("solo sedes abiertas y proveedores activos", async () => {
    /* Dejar un equipo en una sede cerrada lo registra donde nadie va a
       buscarlo; un proveedor de baja ya no atiende un reclamo. */
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    expect(listarSedes).toHaveBeenCalledWith(
      expect.objectContaining({ activa: "true" }),
    );
    expect(listarProveedores).toHaveBeenCalledWith(
      expect.objectContaining({ activo: "true" }),
    );
    expect(listarEmpleados).toHaveBeenCalledWith(
      expect.objectContaining({ activo: "true" }),
    );
  });

  it("la sede se muestra con su ciudad: es lo que se lee al buscar el equipo", async () => {
    pintar();

    expect(
      await screen.findByRole("option", { name: "Matriz — Quito" }),
    ).toBeInTheDocument();
  });

  it("un equipo puede quedarse sin custodio, y se dice dónde queda", async () => {
    pintar();

    expect(
      await screen.findByRole("option", {
        name: "Sin asignar (queda en bodega)",
      }),
    ).toBeInTheDocument();
  });

  it("si un catálogo falla, el formulario sigue usable", async () => {
    listarProveedores.mockRejectedValue(new Error("500"));

    pintar();

    expect(
      await screen.findByRole("option", { name: "Laptop (LAP)" }),
    ).toBeInTheDocument();
  });
});

// --- Las características que declara el tipo --------------------------------

describe("Las características dependen del tipo elegido", () => {
  it("sin tipo elegido no se piden características de ninguno", async () => {
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    expect(caracteristicasDelTipo).not.toHaveBeenCalled();
  });

  it("al elegir un tipo se piden las suyas, no las del anterior", async () => {
    caracteristicasDelTipo.mockResolvedValue([
      {
        id: 1,
        nombre: "Procesador",
        dato: "texto",
        unidad: "",
        obligatoria: true,
        opciones: [],
      },
    ]);

    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
      target: { value: "1" },
    });

    await waitFor(() =>
      expect(caracteristicasDelTipo).toHaveBeenCalledWith("1"),
    );
    expect(
      await screen.findByText("Características del equipo"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Procesador/)).toBeRequired();
  });

  it("un tipo que aún no se describió sigue admitiendo pares libres", async () => {
    /* El catálogo se llena con el tiempo; hasta entonces no se puede dejar de
       poder capturar la RAM de una laptop. */
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
      target: { value: "1" },
    });

    expect(
      await screen.findByText("Especificaciones del hardware"),
    ).toBeInTheDocument();
  });
});

// --- El alta ----------------------------------------------------------------

describe("Registrar un activo", () => {
  it("dice que el código de barras se genera solo", async () => {
    /* Es el primer campo que alguien busca al dar de alta; sin decirlo, se
       teclearía uno inventado. */
    pintar();

    expect(
      await screen.findByText(/El código de barras se genera automáticamente/),
    ).toBeInTheDocument();
  });

  it("los campos opcionales vacíos viajan como nulos", async () => {
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    llenarMinimo();
    fireEvent.click(screen.getByRole("button", { name: "Registrar activo" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0]).toMatchObject({
      tipo: "1",
      departamento: "2",
      custodio: null,
      sede: null,
      proveedor: null,
      costo_adquisicion: null,
      fecha_ingreso: null,
      fecha_fin_garantia: null,
    });
  });

  it("la garantía no puede terminar antes de la compra", async () => {
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    fireEvent.change(screen.getByLabelText("Fecha de adquisición"), {
      target: { value: "2026-03-01" },
    });

    expect(screen.getByLabelText("Fin de garantía")).toHaveAttribute(
      "min",
      "2026-03-01",
    );
  });

  it("creado, se abre su ficha: es donde está el código que acaba de nacer", async () => {
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    llenarMinimo();
    fireEvent.click(screen.getByRole("button", { name: "Registrar activo" }));

    expect(
      await screen.findByText("Destino: /admin/activos/42"),
    ).toBeInTheDocument();
  });

  it("si el servidor lo rechaza, lo dice con su motivo y no navega", async () => {
    crear.mockRejectedValue({
      response: {
        data: { error: { message: "Ya existe un activo con esa serie." } },
      },
    });

    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    llenarMinimo();
    fireEvent.click(screen.getByRole("button", { name: "Registrar activo" }));

    expect(
      await screen.findByText("Ya existe un activo con esa serie."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Destino:/)).not.toBeInTheDocument();
  });
});

// --- La edición -------------------------------------------------------------

describe("Editar la ficha", () => {
  it("carga lo registrado", async () => {
    pintar(7);

    expect(await screen.findByText("Editar ficha técnica")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre del activo")).toHaveValue(
        "Laptop Jefatura TI",
      ),
    );
    expect(screen.getByLabelText("Número de serie")).toHaveValue("DL5440-0011");
  });

  it("el custodio y el departamento no se cambian aquí, y explica dónde sí", async () => {
    /* Cambiarlos por la ficha deja el movimiento en el historial; hacerlo
       desde este formulario los movería sin dejar rastro de quién lo tenía. */
    pintar(7);

    await screen.findByText("Editar ficha técnica");
    await waitFor(() =>
      expect(screen.getByLabelText("Custodio")).toBeDisabled(),
    );
    expect(screen.getByLabelText("Departamento")).toBeDisabled();
    expect(
      screen.getByText(/se cambian desde la ficha, con la acción «Asignar/),
    ).toBeInTheDocument();
  });

  it("guardar no manda custodio ni departamento", async () => {
    pintar(7);

    await screen.findByText("Editar ficha técnica");
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre del activo")).toHaveValue(
        "Laptop Jefatura TI",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(actualizar).toHaveBeenCalled());
    const enviado = actualizar.mock.calls[0][1];
    expect(enviado).not.toHaveProperty("custodio");
    expect(enviado).not.toHaveProperty("departamento");
    expect(crear).not.toHaveBeenCalled();
  });

  it("guardado, vuelve a la ficha del equipo", async () => {
    pintar(7);

    await screen.findByText("Editar ficha técnica");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(
      await screen.findByText("Destino: /admin/activos/7"),
    ).toBeInTheDocument();
  });

  it("lo que el equipo traía y su tipo ya no declara se conserva aparte", async () => {
    /* Un equipo cargado antes de que el tipo se describiera arrastra
       características que ya nadie declara: borrarlas en silencio perdería lo
       único que se sabe de ese equipo. */
    caracteristicasDelTipo.mockResolvedValue([
      {
        id: 1,
        nombre: "Procesador",
        dato: "texto",
        unidad: "",
        obligatoria: false,
        opciones: [],
      },
    ]);

    pintar(7);

    expect(
      await screen.findByText("Características anteriores"),
    ).toBeInTheDocument();
    expect(screen.getByText("RAM")).toBeInTheDocument();
  });

  it("si la ficha no carga lo dice", async () => {
    obtener.mockRejectedValue(new Error("404"));

    pintar(7);

    expect(
      await screen.findByText("No se pudo cargar el activo."),
    ).toBeInTheDocument();
  });
});

// --- Nuevo o usado ----------------------------------------------------------

describe("La condición al adquirirlo", () => {
  it("se puede dejar sin decir, y es lo que viene por delante", async () => {
    /* El levantamiento inicial se hace con equipos cuya procedencia ya nadie
       recuerda: dar «nuevo» por supuesto sería inventarla. */
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    expect(screen.getByLabelText("Condición al adquirirlo")).toHaveValue("");
    expect(
      screen.getByRole("option", { name: "Sin especificar" }),
    ).toBeInTheDocument();
  });

  it("se elige nuevo o usado y viaja al guardar", async () => {
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    llenarMinimo();
    fireEvent.change(screen.getByLabelText("Condición al adquirirlo"), {
      target: { value: "usado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar activo" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].condicion).toBe("usado");
  });

  it("sin decirla, viaja vacía y no como «nuevo»", async () => {
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    llenarMinimo();
    fireEvent.click(screen.getByRole("button", { name: "Registrar activo" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].condicion).toBe("");
  });

  it("al editar llega la que tenía, para poder corregirla", async () => {
    /* Es un dato que a menudo se completa después, cuando aparece la factura. */
    obtener.mockResolvedValue({ ...ACTIVO, condicion: "usado" });

    pintar(7);

    await screen.findByText("Editar ficha técnica");
    await waitFor(() =>
      expect(screen.getByLabelText("Condición al adquirirlo")).toHaveValue(
        "usado",
      ),
    );
  });
});

// --- De quién es el equipo --------------------------------------------------

describe("Propio o puesto por un partner", () => {
  it("por delante viene «de la empresa», que es lo normal", async () => {
    /* Obligar a decirlo en cada alta no capturaría nada que no se supiera ya:
       la inmensa mayoría del parque se compró. */
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    expect(screen.getByLabelText("De quién es el equipo")).toHaveValue(
      "propia",
    );
  });

  it("no se pregunta por el partner mientras el equipo sea propio", async () => {
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    expect(screen.queryByLabelText("Concesionario")).not.toBeInTheDocument();
  });

  it("al marcarlo en concesión se pide de quién es", async () => {
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    fireEvent.change(screen.getByLabelText("De quién es el equipo"), {
      target: { value: "concesion" },
    });

    expect(
      await screen.findByRole("option", { name: "Servientrega Andina" }),
    ).toBeInTheDocument();
  });

  it("el partner elegido viaja al guardar", async () => {
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    llenarMinimo();
    fireEvent.change(screen.getByLabelText("De quién es el equipo"), {
      target: { value: "concesion" },
    });
    fireEvent.change(await screen.findByLabelText("Concesionario"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar activo" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0]).toMatchObject({
      propiedad: "concesion",
      concesionario: "6",
    });
  });

  it("al volverlo propio, el partner deja de viajar", async () => {
    /* Dejarlo puesto haría que el equipo se siguiera contando como ajeno en
       cada reporte, aunque la empresa lo haya terminado comprando. */
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    llenarMinimo();
    fireEvent.change(screen.getByLabelText("De quién es el equipo"), {
      target: { value: "concesion" },
    });
    fireEvent.change(await screen.findByLabelText("Concesionario"), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText("De quién es el equipo"), {
      target: { value: "propia" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar activo" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].concesionario).toBeNull();
  });

  it("solo ofrece partners vigentes", async () => {
    /* Uno dado de baja ya no opera con nosotros: registrarle un equipo nuevo
       no significa nada. */
    pintar();

    await screen.findByRole("option", { name: "Laptop (LAP)" });
    expect(listarConcesionarios).toHaveBeenCalledWith(
      expect.objectContaining({ activo: "true" }),
    );
  });

  it("al editar llega puesto lo que el equipo ya tenía", async () => {
    obtener.mockResolvedValue({
      ...ACTIVO,
      propiedad: "concesion",
      concesionario: 6,
    });

    pintar(7);

    await screen.findByText("Editar ficha técnica");
    await waitFor(() =>
      expect(screen.getByLabelText("Concesionario")).toHaveValue("6"),
    );
  });
});
