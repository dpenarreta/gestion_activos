import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOTIVO, darMotivo } from "./motivo";

/*
 * Módulo Institucional: el organigrama de la empresa (niveles, unidades y
 * cargos), cómo se arma y quién ocupa cada cargo.
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: permisos.lista } }),
}));

const servicio = {
  organigrama: vi.fn(),
  crear: vi.fn(),
  actualizar: vi.fn(),
  eliminar: vi.fn(),
  asignaciones: vi.fn(),
  asignar: vi.fn(),
  plantillaPersonas: vi.fn(),
  exportarOrganigrama: vi.fn(),
  cargarPersonas: vi.fn(),
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));
const misDatos = { obtener: vi.fn() };
vi.mock("../src/api/misDatosService", () => ({ misDatosService: misDatos }));
vi.mock("../src/api/organizacionService", () => ({
  departamentosService: { list: vi.fn(() => Promise.resolve([])) },
}));

const { armarArbol, nombreDeCargo, totalesDe } =
  await import("../src/pages/Institucional/organigrama");
const { OrganigramaPage } =
  await import("../src/pages/Institucional/OrganigramaPage");
const { EstructuraPage } =
  await import("../src/pages/Institucional/EstructuraPage");
const { InicioInstitucional } =
  await import("../src/pages/Institucional/InicioInstitucional");
const { UnsavedChangesProvider } =
  await import("../src/context/UnsavedChangesContext");
const { getVisibleAdminMenu, modulosConAcceso } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");
const { moduloDeRuta } = await import("../src/modulos/modulos");

const ORGANIGRAMA = {
  niveles: [
    { id: 1, nombre: "Presidencia", orden: 1 },
    { id: 2, nombre: "Gerencia", orden: 2 },
  ],
  unidades: [
    {
      id: 10,
      nombre: "Presidencia ejecutiva",
      nivel: 1,
      padre: null,
      departamento: null,
      activa: true,
    },
    {
      id: 11,
      nombre: "Gerencia de TI",
      nivel: 2,
      padre: 10,
      departamento: { id: 3, nombre: "Tecnología" },
      activa: true,
    },
  ],
  cargos: [
    {
      id: 21,
      nombre: "Analista de TI",
      unidad: 11,
      jefe: 20,
      plazas: 3,
      activo: true,
      ocupantes: [{ id: 7, nombre: "Rosa Vera" }],
      vacantes: 2,
    },
    {
      id: 20,
      nombre: "Gerente de TI",
      unidad: 11,
      jefe: null,
      plazas: 1,
      activo: true,
      ocupantes: [],
      vacantes: 1,
    },
  ],
};

function pintar(elemento, ruta = "/") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>{elemento}</MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear(); // la vista del organigrama se recuerda
  vi.clearAllMocks();
  permisos.lista = ["institucional.ver", "institucional.editar"];
  servicio.organigrama.mockResolvedValue(ORGANIGRAMA);
});

describe("El árbol", () => {
  it("cuelga cada unidad de su padre y ordena los cargos de jefe a subordinado", () => {
    const [raiz] = armarArbol(ORGANIGRAMA);
    expect(raiz.nombre).toBe("Presidencia ejecutiva");
    const [ti] = raiz.hijas;
    expect(ti.cargos.map((c) => c.nombre)).toEqual([
      "Gerente de TI",
      "Analista de TI",
    ]);
    expect(totalesDe(raiz)).toEqual({ plazas: 4, vacantes: 3 });
  });

  it("dos cargos con el mismo nombre en una unidad se distinguen por su jefe", () => {
    const cargos = [
      ...ORGANIGRAMA.cargos,
      { id: 22, nombre: "Analista de TI", unidad: 11, jefe: 21, plazas: 1 },
    ];
    expect(nombreDeCargo(cargos[0], ORGANIGRAMA.unidades, cargos)).toBe(
      "Analista de TI · Gerencia de TI (reporta a Gerente de TI)",
    );
    expect(nombreDeCargo(cargos[1], ORGANIGRAMA.unidades, cargos)).toBe(
      "Gerente de TI · Gerencia de TI",
    );
  });

  it("es un módulo propio, con su menú", () => {
    expect(moduloDeRuta("/admin/institucional/organigrama")).toBe(
      "institucional",
    );
    // Es el de entrada: toda persona lo tiene, aunque solo con su «Inicio».
    // La Mesa de ayuda, con «Ver sus tickets en la Mesa de ayuda» (todos los
    // roles lo traen, 09/11/2026); antes su Bandeja era de todos.
    expect(modulosConAcceso(["institucional.ver"])).toEqual(["institucional"]);
    expect(modulosConAcceso([])).toEqual(["institucional"]);
    expect(
      modulosConAcceso(["institucional.ver", "soporte.mesa_mis_tickets"]),
    ).toEqual(["soporte", "institucional"]);
  });
});

describe("El organigrama", () => {
  it("muestra unidades, cargos, a quién reportan, quién los ocupa y las vacantes", async () => {
    pintar(<OrganigramaPage />);

    const ti = await screen.findByRole("region", { name: "Gerencia de TI" });
    // La unidad es el departamento: ya no se repite «Área: …» debajo.
    expect(within(ti).queryByText(/^Área:/)).not.toBeInTheDocument();
    // Árbol por niveles: el subordinado va dentro de la rama de su jefe.
    const jefe = within(ti)
      .getByText("Gerente de TI", { selector: "strong" })
      .closest("li");
    expect(within(jefe).getByText("Analista de TI")).toBeInTheDocument();
    expect(within(ti).getByText(/Rosa Vera/)).toBeInTheDocument();
    expect(within(ti).getByText("2 plazas vacantes")).toBeInTheDocument();
    expect(within(ti).getByText("1/3")).toBeInTheDocument();
    // La cifra se lee entera: «1 de 3 plazas cubiertas».
    expect(within(ti).getByText("1/3")).toHaveAttribute("aria-hidden", "true");
    expect(within(ti).getByText("1 de 3 plazas cubiertas")).toBeInTheDocument();
    expect(screen.getByText("1 de 4 plazas cubiertas")).toBeInTheDocument();
  });

  it("las vistas son radios nativos: una parada de Tab y flechas", async () => {
    pintar(<OrganigramaPage />);
    const grupo = await screen.findByRole("radiogroup", {
      name: "Cómo ver el organigrama",
    });
    const radios = within(grupo).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio.tagName).toBe("INPUT");
      expect(radio).toHaveAttribute("name", "org-vista");
    }
    expect(
      within(grupo).getByRole("radio", { name: /Árbol por niveles/ }),
    ).toBeChecked();
  });

  it("también se ve en lista, con a quién reporta cada cargo", async () => {
    pintar(<OrganigramaPage />);
    fireEvent.click(await screen.findByRole("radio", { name: /Lista/ }));
    const ti = screen.getByRole("region", { name: "Gerencia de TI" });
    expect(within(ti).getByText("Reporta a Gerente de TI")).toBeInTheDocument();
  });

  it("una rama se contrae", async () => {
    pintar(<OrganigramaPage />);
    const raiz = await screen.findByRole("region", {
      name: "Presidencia ejecutiva",
    });
    // El botón dice de qué unidad es (revisión final UX/UI, 28/10/2026).
    fireEvent.click(
      within(raiz).getByRole("button", {
        name: "Contraer Presidencia ejecutiva",
      }),
    );
    expect(
      screen.queryByRole("region", { name: "Gerencia de TI" }),
    ).not.toBeInTheDocument();
    expect(
      within(raiz).getByRole("button", {
        name: /^Ver 1 unidad\(es\) · \d+ plazas\s?, en Presidencia ejecutiva$/,
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("busca un cargo o una persona", async () => {
    pintar(<OrganigramaPage />);
    fireEvent.change(
      await screen.findByLabelText("Buscar un cargo o una persona"),
      { target: { value: "rosa" } },
    );
    const resultados = screen.getByRole("list", { name: "Resultados" });
    expect(
      within(resultados).getByText("Analista de TI · Gerencia de TI"),
    ).toBeInTheDocument();
  });

  it("el zoom cambia solo el árbol, dentro de su marco", async () => {
    pintar(<OrganigramaPage />);
    const lienzo = await screen.findByRole("region", {
      name: "Árbol del organigrama",
    });
    const escala = lienzo.firstChild;
    const barra = screen.getByRole("toolbar", { name: "Zoom del organigrama" });
    expect(within(barra).getAllByText("100 %")).toHaveLength(2); // valor y botón

    fireEvent.click(within(barra).getByRole("button", { name: "Acercar" }));
    expect(escala.style.zoom).toBe("1.1");
    fireEvent.click(within(barra).getByRole("button", { name: "Alejar" }));
    fireEvent.click(within(barra).getByRole("button", { name: "Alejar" }));
    expect(escala.style.zoom).toBe("0.9");

    // Ctrl + rueda dentro del marco acerca, y no hace zoom a la página.
    const rueda = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    lienzo.dispatchEvent(rueda);
    expect(rueda.defaultPrevented).toBe(true);
    await waitFor(() => expect(escala.style.zoom).toBe("1"));

    // Con el teclado: + acerca y 0 vuelve al 100 %.
    fireEvent.keyDown(lienzo, { key: "+" });
    expect(escala.style.zoom).toBe("1.1");
    fireEvent.keyDown(lienzo, { key: "0" });
    expect(escala.style.zoom).toBe("1");
  });

  it("el botón a la estructura sale según el permiso", async () => {
    // Con `editar`, «Editar estructura».
    const { unmount } = pintar(<OrganigramaPage />);
    expect(
      await screen.findByRole("link", { name: /Editar estructura/ }),
    ).toHaveAttribute("href", "/admin/institucional/estructura");
    unmount();

    // Solo con `asignar`: entra al organigrama y el botón abre esa pestaña.
    permisos.lista = ["institucional.asignar"];
    pintar(<OrganigramaPage />);
    expect(
      await screen.findByRole("link", { name: /Asignar cargos/ }),
    ).toHaveAttribute(
      "href",
      "/admin/institucional/estructura?pestana=asignaciones",
    );
    expect(
      screen.queryByRole("link", { name: /Editar estructura/ }),
    ).toBeNull();
  });

  it("con solo su área dice cuál está viendo", async () => {
    permisos.lista = ["institucional.ver_area"];
    servicio.organigrama.mockResolvedValue({
      ...ORGANIGRAMA,
      alcance: { tipo: "area", unidad: { id: 11, nombre: "Gerencia de TI" } },
    });
    pintar(<OrganigramaPage />);
    expect(
      await screen.findByText(/Su área: Gerencia de TI/),
    ).toBeInTheDocument();
  });

  it("sin cargo, su área está vacía y lo dice", async () => {
    permisos.lista = ["institucional.ver_area"];
    servicio.organigrama.mockResolvedValue({
      niveles: [],
      unidades: [],
      cargos: [],
      alcance: { tipo: "area", unidad: null },
    });
    pintar(<OrganigramaPage />);
    expect(
      await screen.findByText(/Todavía no tiene un cargo asignado/),
    ).toBeInTheDocument();
  });

  it("«Lista» cambia el dibujo: de árbol horizontal a lista vertical", async () => {
    permisos.lista = ["institucional.ver"];
    pintar(<OrganigramaPage />);
    await screen.findByRole("region", { name: "Gerencia de TI" });
    // De entrada, el árbol en el lienzo con zoom.
    expect(
      screen.getByRole("toolbar", { name: "Zoom del organigrama" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Organigrama en lista" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Lista/ }));
    const lista = screen.getByRole("region", { name: "Organigrama en lista" });
    expect(
      within(lista).getByRole("region", { name: "Gerencia de TI" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: "Zoom del organigrama" }),
    ).toBeNull();
    expect(localStorage.getItem("organigrama.vista")).toBe("lista");

    fireEvent.click(screen.getByRole("radio", { name: /Árbol por niveles/ }));
    expect(
      screen.queryByRole("region", { name: "Organigrama en lista" }),
    ).toBeNull();
  });

  it("la estructura no está en el menú: solo el organigrama", () => {
    // Con los permisos de todo empleado (los de los roles de nivel).
    const menu = getVisibleAdminMenu(
      [
        "institucional.editar",
        "institucional.asignar",
        "licencias.solicitar",
        "roles_pago.consultar",
        "sugerencias.reportar",
      ],
      "institucional",
    );
    const ids = menu
      .filter((i) => i.modulo === "institucional")
      .map((i) => i.id);
    expect(ids).toEqual([
      "institucional-inicio",
      "institucional-organigrama",
      "institucional-permisos",
      "institucional-proyectos",
      "institucional-vacaciones",
      "institucional-onboarding",
      // Sin observaciones a cargo, el grupo «Rol de pagos» va directo a consultar.
      "institucional-rol-pagos-consultar",
      "institucional-codigos",
      "institucional-sugerencias",
    ]);
    // Sin esos permisos, pedir, consultar el rol y reportar no aparecen.
    const sinBase = getVisibleAdminMenu(
      ["institucional.ver"],
      "institucional",
    ).map((i) => i.id);
    expect(sinBase).not.toContain("institucional-permisos");
    expect(sinBase).not.toContain("institucional-rol-pagos");
    expect(sinBase).not.toContain("institucional-rol-pagos-consultar");
    expect(sinBase).not.toContain("institucional-sugerencias");
  });

  it("sin permiso de edición no ofrece editar la estructura", async () => {
    permisos.lista = ["institucional.ver"];
    pintar(<OrganigramaPage />);
    await screen.findByRole("region", { name: "Gerencia de TI" });
    expect(
      screen.queryByRole("link", { name: /Editar estructura/ }),
    ).toBeNull();
  });
});

describe("La estructura", () => {
  it("desde la estructura se descargan la plantilla y el organigrama completo", async () => {
    servicio.plantillaPersonas.mockResolvedValue(new Blob(["p"]));
    servicio.exportarOrganigrama.mockResolvedValue(new Blob(["c"]));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    pintar(<EstructuraPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Plantilla de carga masiva/ }),
    );
    await waitFor(() => expect(servicio.plantillaPersonas).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", { name: /Organigrama completo/ }),
    );
    await waitFor(() =>
      expect(servicio.exportarOrganigrama).toHaveBeenCalled(),
    );
    // Quien solo arma la estructura descarga, pero no carga personas.
    expect(
      screen.queryByRole("button", { name: /Carga masiva de personas/ }),
    ).toBeNull();
  });

  it("crea un cargo en una unidad, con su jefe y sus plazas", async () => {
    servicio.crear.mockResolvedValue({});
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar cargo" }));
    expect(
      screen.getByRole("dialog", { name: "Agregar cargo" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Técnico de soporte" },
    });
    fireEvent.change(screen.getByLabelText("Unidad"), {
      target: { value: "11" },
    });
    fireEvent.change(screen.getByLabelText("Reporta a (jefe inmediato)"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Plazas"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    // Cada cambio pide su motivo (bitácora del organigrama).
    expect(servicio.crear).not.toHaveBeenCalled();
    await darMotivo();

    await waitFor(() =>
      expect(servicio.crear).toHaveBeenCalledWith(
        "cargos",
        {
          nombre: "Técnico de soporte",
          unidad: "11",
          jefe: "20",
          jefes_secundarios: [],
          plazas: "2",
          descripcion: "",
          activo: true,
        },
        MOTIVO,
      ),
    );
  });

  it("el buscador de Cargos filtra en cada tecla, sin tildes ni mayúsculas", async () => {
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    const campo = screen.getByRole("searchbox", { name: "Buscar cargos" });
    fireEvent.change(campo, { target: { value: "ANALÍSTA" } });
    expect(
      screen.getByRole("button", { name: "Editar Analista de TI" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Editar Gerente de TI" }),
    ).toBeNull();
    expect(screen.getByText("1 de 2 cargos")).toBeInTheDocument();
  });

  it("sin coincidencias lo dice y limpiar devuelve el foco al buscador", async () => {
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    const campo = screen.getByRole("searchbox", { name: "Buscar cargos" });
    fireEvent.change(campo, { target: { value: "contador" } });
    expect(
      screen.getByText("Sin resultados para «contador»."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(campo).toHaveValue("");
    expect(campo).toHaveFocus();
  });

  it("editar abre una ventana con los datos del cargo", async () => {
    servicio.actualizar.mockResolvedValue({});
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Editar Analista de TI" }),
    );

    const ventana = screen.getByRole("dialog", {
      name: "Editar cargo: Analista de TI",
    });
    expect(within(ventana).getByLabelText("Plazas")).toHaveValue(3);
    fireEvent.change(within(ventana).getByLabelText("Plazas"), {
      target: { value: "4" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );
    await darMotivo();

    await waitFor(() =>
      expect(servicio.actualizar).toHaveBeenCalledWith(
        "cargos",
        21,
        expect.objectContaining({ plazas: "4", unidad: 11, jefe: 20 }),
        MOTIVO,
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // 10/11/2026: el motivo se pintaba antes que la ventana del formulario y,
  // con el mismo z-index, quedaba debajo; «Guardar cambios» parecía no hacer
  // nada. Tiene que ir después en el DOM para verse encima.
  it("el motivo se abre encima de la ventana del formulario", async () => {
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Editar Analista de TI" }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Editar cargo: Analista de TI",
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );

    const motivo = await screen.findByRole("dialog", {
      name: "¿Por qué se hace este cambio?",
    });
    expect(
      ventana.compareDocumentPosition(motivo) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("si el guardado falla, el error se ve dentro de la ventana", async () => {
    servicio.actualizar.mockRejectedValue({
      response: { data: { detail: "Ya existe un cargo con ese nombre." } },
    });
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Editar Analista de TI" }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Editar cargo: Analista de TI",
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );
    await darMotivo();

    expect(
      await within(ventana).findByText("Ya existe un cargo con ese nombre."),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    ).toBeEnabled();
  });

  it("las plazas se cambian en la misma tabla", async () => {
    servicio.actualizar.mockResolvedValue({});
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));

    const plazas = screen.getByLabelText("Plazas de Analista de TI");
    expect(plazas).toHaveValue(3);
    fireEvent.change(plazas, { target: { value: "5" } });
    fireEvent.keyDown(plazas, { key: "Enter" });
    fireEvent.blur(plazas);
    await darMotivo();

    await waitFor(() =>
      expect(servicio.actualizar).toHaveBeenCalledWith(
        "cargos",
        21,
        { plazas: 5 },
        MOTIVO,
      ),
    );
    expect(servicio.actualizar).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("«Analista de TI» ahora tiene 5 plaza(s)."),
    ).toBeInTheDocument();
  });

  it("lo que no se puede borrar dice por qué", async () => {
    servicio.eliminar.mockRejectedValue({
      response: {
        data: { detail: "La unidad tiene unidades debajo: muévalas primero." },
      },
    });
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Unidades/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Borrar Presidencia ejecutiva" }),
    );
    await darMotivo();
    expect(
      await screen.findByText(/tiene unidades debajo/),
    ).toBeInTheDocument();
  });
});

/** El Analista reporta al Gerente de TI y, en línea punteada, al Jefe
 * Financiero (reporte secundario, 09/11/2026). */
const CON_LINEA_PUNTEADA = {
  ...ORGANIGRAMA,
  cargos: [
    { ...ORGANIGRAMA.cargos[0], jefes_secundarios: [22] },
    { ...ORGANIGRAMA.cargos[1], jefes_secundarios: [] },
    {
      id: 22,
      nombre: "Jefe Financiero",
      unidad: 10,
      jefe: null,
      jefes_secundarios: [],
      plazas: 1,
      activo: true,
      ocupantes: [],
      vacantes: 1,
    },
  ],
};

describe("El reporte secundario (línea punteada)", () => {
  it("el organigrama lo marca en el cargo, en árbol y en lista", async () => {
    servicio.organigrama.mockResolvedValue(CON_LINEA_PUNTEADA);
    pintar(<OrganigramaPage />);
    const ti = await screen.findByRole("region", { name: "Gerencia de TI" });
    expect(
      within(ti).getByText(/También reporta a Jefe Financiero/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Lista/ }));
    const enLista = screen.getByRole("region", { name: "Gerencia de TI" });
    expect(
      within(enLista).getByText("Reporta a Gerente de TI"),
    ).toBeInTheDocument();
    expect(
      within(enLista).getByText(/También reporta a Jefe Financiero/),
    ).toBeInTheDocument();
  });

  it("la tabla de Cargos lo muestra y el buscador lo encuentra", async () => {
    servicio.organigrama.mockResolvedValue(CON_LINEA_PUNTEADA);
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    const fila = screen
      .getByRole("button", { name: "Editar Analista de TI" })
      .closest("tr");
    expect(
      within(fila).getByText(/También reporta a: Jefe Financiero/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar cargos" }), {
      target: { value: "financiero" },
    });
    expect(
      screen.getByRole("button", { name: "Editar Analista de TI" }),
    ).toBeInTheDocument();
  });

  it("se elige con un buscador, sin ofrecer el propio cargo ni su jefe", async () => {
    servicio.organigrama.mockResolvedValue(CON_LINEA_PUNTEADA);
    servicio.actualizar.mockResolvedValue({});
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Editar Analista de TI" }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Editar cargo: Analista de TI",
    });
    const grupo = within(ventana).getByRole("group", {
      name: "También reporta a (opcional)",
    });
    const lista = within(grupo).getByRole("list", {
      name: "Cargos a los que también reporta",
    });
    // Ni él mismo ni su jefe inmediato (Gerente de TI).
    expect(within(lista).getAllByRole("checkbox")).toHaveLength(1);
    expect(
      within(lista).getByRole("checkbox", { name: /Jefe Financiero/ }),
    ).toBeChecked();
    // Quitar lo saca, lo anuncia y devuelve el foco al buscador.
    fireEvent.click(within(grupo).getByRole("button", { name: /Quitar/ }));
    expect(within(grupo).getByLabelText("Buscar cargo")).toHaveFocus();
    expect(within(grupo).getByRole("status")).toHaveTextContent(
      /^Se quitó Jefe Financiero.*\./,
    );
    fireEvent.change(within(grupo).getByLabelText("Buscar cargo"), {
      target: { value: "financ" },
    });
    expect(within(grupo).getByText("1 cargo encontrado.")).toBeInTheDocument();
    fireEvent.click(
      within(lista).getByRole("checkbox", { name: /Jefe Financiero/ }),
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );
    await darMotivo();
    await waitFor(() =>
      expect(servicio.actualizar).toHaveBeenCalledWith(
        "cargos",
        21,
        expect.objectContaining({ jefe: 20, jefes_secundarios: [22] }),
        MOTIVO,
      ),
    );
  });

  it("al elegir como jefe inmediato a un jefe secundario, deja de serlo", async () => {
    servicio.organigrama.mockResolvedValue(CON_LINEA_PUNTEADA);
    servicio.actualizar.mockResolvedValue({});
    pintar(<EstructuraPage />);
    fireEvent.click(await screen.findByRole("tab", { name: /Cargos/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Editar Analista de TI" }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Editar cargo: Analista de TI",
    });
    fireEvent.change(
      within(ventana).getByLabelText("Reporta a (jefe inmediato)"),
      {
        target: { value: "22" },
      },
    );
    // Se anuncia en la región viva del selector.
    expect(
      within(ventana).getByText(
        /Se quitó Jefe Financiero.*: ahora es el jefe inmediato\./,
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Guardar cambios" }),
    );
    await darMotivo();
    await waitFor(() =>
      expect(servicio.actualizar).toHaveBeenCalledWith(
        "cargos",
        21,
        expect.objectContaining({ jefe: "22", jefes_secundarios: [] }),
        MOTIVO,
      ),
    );
  });
});

describe("La asignación de cargos, pestaña de Estructura", () => {
  it("pone a una persona en un cargo", async () => {
    servicio.asignaciones.mockResolvedValue([
      { id: 9, nombre: "Beto Paz", correo: "beto@grupolaar.com", cargo: null },
    ]);
    servicio.asignar.mockResolvedValue({});
    permisos.lista = ["institucional.asignar"];
    pintar(<EstructuraPage />, "/?pestana=asignaciones");

    // Es una pestaña de Estructura; quien solo asigna no ve las otras.
    expect(
      await screen.findByRole("tab", { name: "Asignación de cargos" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /Niveles/ })).toBeNull();

    const selector = await screen.findByLabelText("Cargo de Beto Paz");
    await waitFor(() => expect(selector).not.toBeDisabled());
    expect(
      within(selector).getByRole("option", {
        name: "Gerente de TI · Gerencia de TI",
      }),
    ).toBeInTheDocument();
    fireEvent.change(selector, { target: { value: "20" } });
    await darMotivo();

    await waitFor(() =>
      expect(servicio.asignar).toHaveBeenCalledWith(9, "20", MOTIVO),
    );
    expect(
      await screen.findByText("Beto Paz quedó en su nuevo cargo."),
    ).toBeInTheDocument();
  });
});

it("Estructura no tiene otra opción de menú para asignar: es su pestaña", () => {
  expect(modulosConAcceso(["institucional.asignar"])).toEqual([
    "institucional",
  ]);
});

describe("Inicio, a donde entra toda persona", () => {
  it("sin permisos ofrece lo de todos y pide elegir su cargo", async () => {
    // Lo que tiene toda cuenta sin ningún rol (`PERMISOS_SIN_ROL`).
    permisos.lista = [
      "soporte.crear",
      "soporte.mesa_mis_tickets",
      "soporte.mesa_crear",
    ];
    misDatos.obtener.mockResolvedValue({ nombres: "Rosa", cargo: null });
    pintar(
      <UnsavedChangesProvider>
        <InicioInstitucional />
      </UnsavedChangesProvider>,
    );

    expect(
      await screen.findByText(/Todavía no tiene un cargo asignado/),
    ).toBeInTheDocument();
    for (const nombre of ["Soporte TI", "Chat", "Mi perfil"]) {
      expect(
        screen.getByRole("link", { name: new RegExp(`^${nombre}`) }),
      ).toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: /Organigrama/ })).toBeNull();
    // Su único módulo, además de Institucional, es la Mesa de ayuda (su
    // Bandeja con lo que creó).
    expect(screen.getByText("Sus módulos")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Mesa de ayuda/ }),
    ).toBeInTheDocument();
  });

  it("con permisos muestra su cargo y sus módulos, en el orden del selector", async () => {
    permisos.lista = ["institucional.ver", "activos.ver", "soporte.atender"];
    misDatos.obtener.mockResolvedValue({
      nombres: "Rosa",
      cargo: { id: 21, nombre: "Analista de TI · Gerencia de TI" },
    });
    pintar(
      <UnsavedChangesProvider>
        <InicioInstitucional />
      </UnsavedChangesProvider>,
    );

    expect(
      await screen.findByText("Analista de TI · Gerencia de TI."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Organigrama/ }),
    ).toBeInTheDocument();
    const modulos = within(
      screen.getByRole("region", { name: "Sus módulos" }),
    ).getAllByRole("button");
    expect(modulos.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Mesa de ayuda"),
      expect.stringContaining("Gestión de Activos"),
    ]);
  });
});
