import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * US-005 (11/11/2026): el área sale del cargo y queda bloqueada.
 *
 * - En «Mi perfil» y en la ventana de datos faltantes (las dos usan
 *   `FormularioMisDatos`), el cargo va antes que el área y elegirlo propone
 *   el área de su unidad del organigrama, con la nota «Área del cargo
 *   elegido». Si reemplaza un área que había, se dice junto al cargo. Si el
 *   cargo no tiene área, el campo no cambia. Si todavía no tiene área y ya
 *   tiene cargo, se propone la de ese cargo al abrir.
 * - Con `area_fija` (ya la guardó) el área queda deshabilitada y dice cómo
 *   pedir el cambio; sin ella, avisa que se elige una sola vez. El 400 del
 *   servidor se ve junto al campo.
 * - En «Asignación de cargos» se ve el área de cada persona y solo quien
 *   tiene `organizacion.cambiar_area` la cambia, con motivo.
 */

const misDatos = { obtener: vi.fn(), guardar: vi.fn() };
vi.mock("../src/api/misDatosService", () => ({ misDatosService: misDatos }));

const institucional = {
  asignaciones: vi.fn(),
  cambiarArea: vi.fn(),
  areasParaAsignar: vi.fn(),
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: institucional,
}));

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: permisos.lista } }),
}));

// La ventana del motivo se prueba aparte; aquí basta con lo que responde.
const pedirMotivo = vi.fn();
vi.mock("../src/components/common/PedirMotivo/PedirMotivo", () => ({
  usePedirMotivo: () => [pedirMotivo, null],
}));

const { FormularioMisDatos } =
  await import("../src/pages/MisDatos/MisDatosPage");
const { AsignacionCargos } =
  await import("../src/pages/Institucional/AsignacionCargos");
const { etiquetaDeAccion, etiquetaDeCampo } =
  await import("../src/pages/Admin/Auditoria/etiquetasAuditoria");

const DATOS = {
  nombres: "Carla",
  apellidos: "Ordóñez",
  correo: "carla@grupolaar.com",
  correo_institucional: true,
  telefono: "",
  tiene_telefono_corporativo: false,
  telefono_corporativo: "",
  telefono_autorizacion: { texto: "Autorizo.", aceptado: false },
  area: null,
  area_fija: false,
  area_del_cargo: null,
  agencia: { id: 1, nombre: "Loja · Agencia" },
  cargo: null,
  areas: [
    { id: 2, nombre: "Cobranzas" },
    { id: 3, nombre: "Tesorería" },
    { id: 4, nombre: "Talento Humano" },
  ],
  agencias: [{ id: 1, nombre: "Loja · Agencia" }],
  cargos: [
    {
      id: 5,
      nombre: "Analista · Cobranzas",
      area: { id: 2, nombre: "Cobranzas" },
    },
    {
      id: 6,
      nombre: "Cajero · Tesorería",
      area: { id: 3, nombre: "Tesorería" },
    },
    { id: 7, nombre: "Asesor · Sin unidad", area: null },
  ],
};

function error400(details) {
  return Object.assign(new Error("400"), {
    response: {
      status: 400,
      data: { error: { code: "validation_error", message: "", details } },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = [];
});

describe("Mi perfil: el área sale del cargo", () => {
  it("el cargo va antes que el área", () => {
    render(<FormularioMisDatos datos={DATOS} onGuardado={vi.fn()} />);
    const cargo = screen.getByLabelText(/^Cargo/);
    const area = screen.getByLabelText(/^Área/);
    const agencia = screen.getByLabelText(/^Agencia/);
    expect(
      cargo.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      area.compareDocumentPosition(agencia) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("al elegir un cargo propone su área con la nota, y cambiar de cargo la vuelve a proponer", () => {
    render(<FormularioMisDatos datos={DATOS} onGuardado={vi.fn()} />);
    const area = screen.getByLabelText(/^Área/);
    const cargo = screen.getByLabelText(/^Cargo/);
    expect(area).toHaveValue("");
    expect(screen.queryByText("Área de su cargo")).toBeNull();

    fireEvent.change(cargo, { target: { value: "5" } });
    expect(area).toHaveValue("2");
    expect(area).toHaveAccessibleDescription(/Área de su cargo/);
    // Todo cambio del área se anuncia junto al cargo, también desde vacío.
    expect(cargo).toHaveAccessibleDescription(
      /Al elegirlo, su área pasó a «Cobranzas»\./,
    );

    // La persona la corrige: la nota desaparece (CA-2).
    fireEvent.change(area, { target: { value: "4" } });
    expect(area).toHaveValue("4");
    expect(screen.queryByText("Área de su cargo")).toBeNull();

    // Otro cargo: se vuelve a proponer la suya, y como reemplaza la que
    // eligió a mano, se dice junto al cargo.
    fireEvent.change(cargo, { target: { value: "6" } });
    expect(area).toHaveValue("3");
    expect(screen.getByText("Área de su cargo")).toBeInTheDocument();
    expect(cargo).toHaveAccessibleDescription(
      /Al elegirlo, su área pasó a «Tesorería»\./,
    );
  });

  it("si el cargo no tiene área, el campo no cambia", () => {
    render(<FormularioMisDatos datos={DATOS} onGuardado={vi.fn()} />);
    const area = screen.getByLabelText(/^Área/);
    fireEvent.change(area, { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^Cargo/), {
      target: { value: "7" },
    });
    expect(area).toHaveValue("4");
    expect(screen.queryByText("Área de su cargo")).toBeNull();
    expect(screen.queryByText(/su área pasó a/)).toBeNull();
  });

  it("si el área venía del cargo anterior y el nuevo no tiene, la vacía y lo anuncia", () => {
    render(<FormularioMisDatos datos={DATOS} onGuardado={vi.fn()} />);
    const area = screen.getByLabelText(/^Área/);
    const cargo = screen.getByLabelText(/^Cargo/);
    fireEvent.change(cargo, { target: { value: "5" } });
    expect(area).toHaveValue("2");
    fireEvent.change(cargo, { target: { value: "7" } });
    expect(area).toHaveValue("");
    expect(screen.queryByText("Área de su cargo")).toBeNull();
    expect(cargo).toHaveAccessibleDescription(
      /Este cargo no tiene un área asignada: elíjala\./,
    );
    // El anuncio está en una región que el lector lee al cambiar.
    expect(
      screen
        .getByText(/Este cargo no tiene un área asignada/)
        .closest('[role="status"]'),
    ).not.toBeNull();
  });

  it("envía el área propuesta al guardar", async () => {
    misDatos.guardar.mockResolvedValue({ ...DATOS, area_fija: true });
    const onGuardado = vi.fn();
    render(<FormularioMisDatos datos={DATOS} onGuardado={onGuardado} />);
    fireEvent.change(screen.getByLabelText(/^Cargo/), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onGuardado).toHaveBeenCalled());
    expect(misDatos.guardar).toHaveBeenCalledWith(
      expect.objectContaining({ cargo: "5", area: "2" }),
    );
  });

  it("sin área y con cargo asignado, propone el área de su cargo al abrir", () => {
    render(
      <FormularioMisDatos
        datos={{
          ...DATOS,
          cargo: { id: 6, nombre: "Cajero · Tesorería" },
          area_del_cargo: { id: 3, nombre: "Tesorería" },
        }}
        onGuardado={vi.fn()}
      />,
    );
    const area = screen.getByLabelText(/^Área/);
    expect(area).toHaveValue("3");
    expect(area).toBeEnabled();
    expect(area).toHaveAccessibleDescription(/Área de su cargo/);
    // El cargo ya es fijo: el aviso habla solo del área.
    expect(area).toHaveAccessibleDescription(
      /Revise que su área sea la correcta\./,
    );
  });

  it("no propone el área del cargo si ya tiene una guardada", () => {
    render(
      <FormularioMisDatos
        datos={{
          ...DATOS,
          area: { id: 4, nombre: "Talento Humano" },
          area_fija: true,
          cargo: { id: 6, nombre: "Cajero · Tesorería" },
          area_del_cargo: { id: 3, nombre: "Tesorería" },
        }}
        onGuardado={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/^Área/)).toHaveValue("4");
    expect(screen.queryByText("Área de su cargo")).toBeNull();
  });

  it("sin area_fija avisa que el área se elige una sola vez", () => {
    render(<FormularioMisDatos datos={DATOS} onGuardado={vi.fn()} />);
    const area = screen.getByLabelText(/^Área/);
    expect(area).toHaveAccessibleDescription(
      /La elige una sola vez; revise que sea la de su trabajo\./,
    );
    // Sin elegir nada todavía no hay aviso; al cambiar solo el área, sí.
    expect(screen.queryByText(/Revise que su cargo y su área/)).toBeNull();
    fireEvent.change(area, { target: { value: "3" } });
    expect(area).toHaveAccessibleDescription(
      /Revise que su cargo y su área sean los correctos\./,
    );
    expect(screen.getByLabelText(/^Cargo/)).toHaveAccessibleDescription(
      /pídalo a Gestión Humana por la Mesa de ayuda/,
    );
  });

  it("con area_fija el área queda deshabilitada, dice cómo pedir el cambio y el cargo no la toca", () => {
    render(
      <FormularioMisDatos
        datos={{
          ...DATOS,
          area: { id: 4, nombre: "Talento Humano" },
          area_fija: true,
        }}
        onGuardado={vi.fn()}
      />,
    );
    const area = screen.getByLabelText(/^Área/);
    expect(area).toBeDisabled();
    expect(area).toHaveValue("4");
    expect(area).toHaveAccessibleDescription(
      "Si no es la correcta, pídala a Gestión Humana por la Mesa de ayuda.",
    );
    fireEvent.change(screen.getByLabelText(/^Cargo/), {
      target: { value: "5" },
    });
    expect(area).toHaveValue("4");
    expect(screen.queryByText("Área de su cargo")).toBeNull();
  });

  it("el área guardada inactiva se muestra marcada", () => {
    render(
      <FormularioMisDatos
        datos={{
          ...DATOS,
          area: { id: 9, nombre: "Archivo" },
          area_fija: true,
        }}
        onGuardado={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("option", { name: "Archivo (inactiva)" }),
    ).toBeInTheDocument();
  });

  it("el 400 del área se muestra junto al campo", async () => {
    misDatos.guardar.mockRejectedValue(
      error400({
        area: ["El área la cambia Gestión Humana o una persona autorizada."],
      }),
    );
    render(<FormularioMisDatos datos={DATOS} onGuardado={vi.fn()} />);
    const area = screen.getByLabelText(/^Área/);
    fireEvent.change(area, { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/^Cargo/), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(area).toHaveAttribute("aria-invalid", "true"));
    expect(area).toHaveAccessibleDescription(
      /El área la cambia Gestión Humana o una persona autorizada\./,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Revise los campos marcados.",
    );
    // Al corregirla, el error se va.
    fireEvent.change(area, { target: { value: "3" } });
    expect(area).not.toHaveAttribute("aria-invalid");
  });
});

const ORGANIGRAMA = {
  cargos: [{ id: 9, nombre: "Analista", activo: true, unidad: 1 }],
  unidades: [{ id: 1, nombre: "Cobranzas", activa: true }],
};

const AREAS = [
  { id: 2, nombre: "Cobranzas" },
  { id: 3, nombre: "Tesorería" },
];

const PERSONAS = [
  {
    id: 11,
    nombre: "Luis Paz",
    correo: "luis@grupolaar.com",
    cargo: { id: 9 },
    area: { id: 2, nombre: "Cobranzas" },
  },
  {
    id: 12,
    nombre: "Ana Ríos",
    correo: "ana@grupolaar.com",
    cargo: null,
    area: null,
  },
];

async function pintarAsignaciones() {
  institucional.asignaciones.mockResolvedValue(PERSONAS);
  institucional.areasParaAsignar.mockResolvedValue(AREAS);
  render(
    <MemoryRouter>
      <AsignacionCargos datos={ORGANIGRAMA} />
    </MemoryRouter>,
  );
  await screen.findByText("Luis Paz");
}

/** Elige un área en la fila y pulsa su «Guardar». */
function cambiarArea(nombre, valor) {
  fireEvent.change(screen.getByLabelText(`Área de ${nombre}`), {
    target: { value: valor },
  });
  fireEvent.click(
    screen.getByRole("button", { name: `Guardar el área de ${nombre}` }),
  );
}

describe("Asignación de cargos: el área de cada persona", () => {
  it("sin el permiso solo se lee", async () => {
    await pintarAsignaciones();
    expect(
      screen.getByRole("columnheader", { name: "Área" }),
    ).toBeInTheDocument();
    const fila = screen.getByText("Luis Paz").closest("tr");
    expect(within(fila).getByText("Cobranzas")).toBeInTheDocument();
    expect(screen.queryByLabelText("Área de Luis Paz")).toBeNull();
    expect(institucional.areasParaAsignar).not.toHaveBeenCalled();
    const otra = screen.getByText("Ana Ríos").closest("tr");
    expect(within(otra).getByText("Sin área")).toBeInTheDocument();
  });

  it("con el permiso cambia el área con motivo, avisa y devuelve el foco al select", async () => {
    permisos.lista = ["organizacion.cambiar_area"];
    pedirMotivo.mockResolvedValue("Traslado a caja");
    let responder;
    institucional.cambiarArea.mockReturnValue(
      new Promise((r) => {
        responder = r;
      }),
    );
    await pintarAsignaciones();
    const select = screen.getByLabelText("Área de Luis Paz");
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Cobranzas", "Tesorería"]),
    );
    // Ya tiene área: «Sin área» no se ofrece (quitarla no se permite).
    expect(
      within(select).queryByRole("option", { name: "Sin área" }),
    ).toBeNull();
    // La persona sin área sí la ve, como punto de partida.
    expect(
      within(screen.getByLabelText("Área de Ana Ríos")).getByRole("option", {
        name: "Sin área",
      }),
    ).toBeInTheDocument();
    // Sin cambio no hay botón.
    expect(
      screen.queryByRole("button", { name: "Guardar el área de Luis Paz" }),
    ).toBeNull();

    cambiarArea("Luis Paz", "3");
    await waitFor(() =>
      expect(institucional.cambiarArea).toHaveBeenCalledWith(
        11,
        3,
        "Traslado a caja",
      ),
    );
    expect(pedirMotivo).toHaveBeenCalledWith(
      "Luis Paz pasa del área «Cobranzas» a «Tesorería». Se ajustan los roles de su cargo.",
    );
    // Mientras guarda, el botón sigue en su sitio pero no repite el envío.
    const boton = screen.getByRole("button", {
      name: "Guardando… el área de Luis Paz",
    });
    expect(boton).toBeEnabled();
    expect(boton).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(boton);
    expect(institucional.cambiarArea).toHaveBeenCalledTimes(1);
    // Y el select no se cambia a medio guardar.
    expect(select).toBeDisabled();

    // La lista se recarga ya con el área nueva.
    institucional.asignaciones.mockResolvedValue([
      { ...PERSONAS[0], area: { id: 3, nombre: "Tesorería" } },
      PERSONAS[1],
    ]);
    responder({ usuario: 11, area: { id: 3, nombre: "Tesorería" } });
    expect(
      await screen.findByText("Luis Paz quedó en el área «Tesorería»."),
    ).toBeInTheDocument();
    await waitFor(() => expect(select).toHaveFocus());
    expect(select).toHaveValue("3");
  });

  it("si cancela el motivo, no se guarda", async () => {
    permisos.lista = ["organizacion.cambiar_area"];
    pedirMotivo.mockResolvedValue(null);
    await pintarAsignaciones();
    await waitFor(() =>
      expect(institucional.areasParaAsignar).toHaveBeenCalled(),
    );
    await screen.findAllByRole("option", { name: "Tesorería" });
    cambiarArea("Ana Ríos", "2");
    await waitFor(() => expect(pedirMotivo).toHaveBeenCalled());
    expect(institucional.cambiarArea).not.toHaveBeenCalled();
    // El select vuelve a la que tenía y el botón se va.
    await waitFor(() =>
      expect(screen.getByLabelText("Área de Ana Ríos")).toHaveValue(""),
    );
    expect(
      screen.queryByRole("button", { name: "Guardar el área de Ana Ríos" }),
    ).toBeNull();
  });

  it("mientras llegan las áreas no marca «(inactiva)» ni ofrece guardar", async () => {
    permisos.lista = ["organizacion.cambiar_area"];
    institucional.asignaciones.mockResolvedValue(PERSONAS);
    institucional.areasParaAsignar.mockReturnValue(new Promise(() => {}));
    render(
      <MemoryRouter>
        <AsignacionCargos datos={ORGANIGRAMA} />
      </MemoryRouter>,
    );
    await screen.findByText("Luis Paz");
    const select = screen.getByLabelText("Área de Luis Paz");
    expect(select).toHaveValue("2");
    expect(
      within(select).getByRole("option", { name: "Cobranzas" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\(inactiva\)/)).toBeNull();
    fireEvent.change(select, { target: { value: "" } });
    expect(screen.queryByRole("button", { name: /el área de/ })).toBeNull();
  });

  it("si fallan las áreas, avisa con «Reintentar» y el aviso no se borra con otra acción", async () => {
    permisos.lista = ["organizacion.cambiar_area"];
    institucional.asignaciones.mockResolvedValue(PERSONAS);
    institucional.areasParaAsignar
      .mockRejectedValueOnce(new Error("caída"))
      .mockResolvedValueOnce(AREAS);
    render(
      <MemoryRouter>
        <AsignacionCargos datos={ORGANIGRAMA} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("No se pudieron cargar las áreas."),
    ).toBeInTheDocument();
    // Otra acción (buscar) no la borra.
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Luis" },
    });
    expect(
      screen.getByText("No se pudieron cargar las áreas."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(screen.queryByText("No se pudieron cargar las áreas.")).toBeNull(),
    );
    expect(institucional.areasParaAsignar).toHaveBeenCalledTimes(2);
  });

  it("el aviso de éxito va en una región siempre montada y se limpia al buscar", async () => {
    permisos.lista = ["organizacion.cambiar_area"];
    pedirMotivo.mockResolvedValue("Traslado a caja");
    institucional.cambiarArea.mockResolvedValue({
      usuario: 12,
      area: AREAS[0],
    });
    await pintarAsignaciones();
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    await screen.findAllByRole("option", { name: "Tesorería" });
    cambiarArea("Ana Ríos", "2");
    await waitFor(() =>
      expect(region).toHaveTextContent(
        "Ana Ríos quedó en el área «Cobranzas».",
      ),
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Ana" },
    });
    expect(region).toBeEmptyDOMElement();
  });

  it("el 400 queda junto al campo como alerta, quita el aviso anterior y devuelve el foco", async () => {
    permisos.lista = ["organizacion.cambiar_area"];
    pedirMotivo.mockResolvedValue("Traslado a caja");
    institucional.cambiarArea
      .mockResolvedValueOnce({ usuario: 12, area: AREAS[0] })
      .mockRejectedValueOnce(
        error400({ area: ["Elija un área activa de la empresa."] }),
      );
    await pintarAsignaciones();
    await screen.findAllByRole("option", { name: "Tesorería" });

    // Primero un cambio bien hecho en otra fila.
    cambiarArea("Ana Ríos", "2");
    expect(
      await screen.findByText("Ana Ríos quedó en el área «Cobranzas»."),
    ).toBeInTheDocument();

    cambiarArea("Luis Paz", "3");
    const select = screen.getByLabelText("Área de Luis Paz");
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Elija un área activa de la empresa.");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAccessibleDescription(
      /Elija un área activa de la empresa\./,
    );
    expect(screen.queryByText(/Ana Ríos quedó en el área/)).toBeNull();
    await waitFor(() => expect(select).toHaveFocus());
  });
});

describe("Auditoría: el cambio de área", () => {
  it("tiene su etiqueta", () => {
    expect(etiquetaDeAccion("organizacion.area_cambiada")).toBe(
      "Cambió el área de una persona",
    );
    expect(etiquetaDeCampo("area")).toBe("Área");
  });
});
