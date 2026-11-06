import { readFileSync } from "node:fs";
import path from "node:path";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ME_GESTOR,
  ME_LECTOR,
  detalle,
  errorApi,
  servicioFalso,
} from "./gestionHumanaMejoraDatos";

/*
 * Mejora continua de Gestión Humana: el menú por permisos, el tablero por
 * etapas (Mis ideas, vacío, error, sin permiso de proponer), el voto
 * optimista con reversión, el formulario (validaciones del adjunto y errores
 * por campo) y el detalle (adjunto en el visor interno, historial, acciones
 * de etapa con `expected_status`, rechazo con motivo, 409 y avance). Los
 * servicios van simulados.
 */

const servicio = servicioFalso();
vi.mock("../src/api/mejoraContinuaService", async (importOriginal) => ({
  ...(await importOriginal()),
  mejoraContinuaService: servicio,
}));
const descargar = vi.fn();
vi.mock("../src/api/soporteService", () => ({
  soporteService: { descargar: (...a) => descargar(...a) },
}));
const descargarBlob = vi.fn();
vi.mock("../src/utils/descargas", () => ({
  descargarBlob: (...a) => descargarBlob(...a),
}));
vi.mock("../src/components/common/VisorPdf/VisorPdf", () => ({
  MarcoPdf: () => <div />,
  useUrlDePdf: () => "blob:doc",
  VisorPdf: ({ titulo }) => <div role="dialog" aria-label={titulo} />,
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: [] } }),
}));

const { MarcoMejoraContinua } =
  await import("../src/pages/GestionHumana/MejoraContinua/ContextoMejoraContinua");
const { MejoraContinua } =
  await import("../src/pages/GestionHumana/MejoraContinua/MejoraContinua");
const { DetalleIdea } =
  await import("../src/pages/GestionHumana/MejoraContinua/DetalleIdea");
const { getVisibleAdminMenu } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");
const { problemaDelAdjunto } =
  await import("../src/pages/GestionHumana/MejoraContinua/mejoraComunes");

const TABLERO = "/admin/gestion-humana/mejora-continua";
const DETALLE = `${TABLERO}/10`;

function pintar(ruta = TABLERO) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/admin/gestion-humana" element={<MarcoMejoraContinua />}>
          <Route path="mejora-continua" element={<MejoraContinua />} />
          <Route path="mejora-continua/:ideaId" element={<DetalleIdea />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function usar(me) {
  Object.assign(servicio, servicioFalso(me));
}

beforeEach(() => {
  usar(undefined);
  descargar.mockReset();
  descargar.mockResolvedValue({ data: new Blob(["x"]) });
  descargarBlob.mockReset();
});

/** Una promesa que el test resuelve o rechaza cuando quiere. */
function diferida() {
  let resolver;
  let rechazar;
  const promesa = new Promise((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

// --- Menú ---------------------------------------------------------------------

const hojas = (items) =>
  items.flatMap((i) => [...(i.path ? [i] : []), ...hojas(i.children ?? [])]);
const entradas = (permisos) =>
  hojas(getVisibleAdminMenu(permisos, "gestion_humana")).map((i) => i.id);

describe("Mejora continua en el menú", () => {
  it("aparece con cualquiera de los tres permisos", () => {
    for (const p of [
      "mejora_continua.acceder",
      "mejora_continua.ver_todas",
      "mejora_continua.gestionar",
    ])
      expect(entradas([p])).toContain("gh-mejora-continua");
  });

  it("no aparece sin permisos de Mejora continua", () => {
    expect(entradas(["tareas.acceder"])).not.toContain("gh-mejora-continua");
  });
});

// --- Tablero ------------------------------------------------------------------

const columna = (nombre) =>
  screen.getByRole("region", { name: new RegExp(`^${nombre}`) });

describe("Tablero de ideas", () => {
  it("reparte las ideas por etapa, con impacto, autor e insignia en texto", async () => {
    pintar();
    await screen.findByRole("link", {
      name: "Digitalizar las solicitudes de vacaciones",
    });
    // Las siete etapas, cada una con su título.
    for (const etapa of [
      "Propuesta",
      "En revisión",
      "Aprobada",
      "En desarrollo",
      "En pruebas",
      "Implementada",
      "Rechazada",
    ])
      expect(
        screen.getByRole("heading", { name: new RegExp(`^${etapa}`) }),
      ).toBeInTheDocument();
    const propuesta = columna("Propuesta");
    expect(
      within(propuesta).getByRole("link", {
        name: "Digitalizar las solicitudes de vacaciones",
      }),
    ).toHaveAttribute("href", `${TABLERO}/10`);
    expect(within(propuesta).getByText("Impacto alto")).toBeInTheDocument();
    const desarrollo = columna("En desarrollo");
    expect(within(desarrollo).getByText("Mi idea")).toBeInTheDocument();
    expect(
      within(desarrollo).getByRole("progressbar", { name: "Avance" }),
    ).toHaveAttribute("aria-valuenow", "40");
    const rechazada = columna("Rechazada");
    expect(within(rechazada).getByText("Innovador")).toBeInTheDocument();
    expect(
      within(rechazada).getByText("Ya existe en otro proceso."),
    ).toBeInTheDocument();
  });

  it("«Mis ideas» pide solo las propias", async () => {
    pintar();
    fireEvent.click(await screen.findByRole("tab", { name: /Mis ideas/ }));
    await waitFor(() =>
      expect(servicio.listar).toHaveBeenLastCalledWith({ soloMias: true }),
    );
  });

  it("ocultar rechazadas quita la columna", async () => {
    pintar();
    await screen.findByRole("link", { name: "Encuesta de salida" });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Ocultar rechazadas" }),
    );
    expect(
      screen.queryByRole("region", { name: /^Rechazada/ }),
    ).not.toBeInTheDocument();
  });

  it("vacío: invita a proponer la primera idea", async () => {
    servicio.listar.mockResolvedValue([]);
    pintar();
    expect(
      await screen.findByText("Todavía no hay ideas en el tablero."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Proponer la primera idea" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Proponer una idea de mejora",
      }),
    ).toBeInTheDocument();
  });

  it("un error se muestra con Reintentar", async () => {
    servicio.listar.mockRejectedValueOnce(errorApi(500, "Falló el servidor."));
    pintar();
    expect(await screen.findByText("Falló el servidor.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("link", { name: "Encuesta de salida" }),
    ).toBeInTheDocument();
  });

  it("sin permiso de proponer ni votar: sin botón y con el conteo como texto", async () => {
    usar(ME_LECTOR);
    pintar();
    await screen.findByRole("link", { name: "Encuesta de salida" });
    expect(
      screen.queryByRole("button", { name: /Proponer idea/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Votar por/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/5 votos/)).toBeInTheDocument();
  });
});

// --- Voto ---------------------------------------------------------------------

describe("Voto", () => {
  it("es optimista: sube al instante y queda con lo que dice el servidor", async () => {
    const respuesta = diferida();
    servicio.votar.mockReturnValue(respuesta.promesa);
    pintar();
    const boton = await screen.findByRole("button", {
      name: /Votar por «Digitalizar las solicitudes de vacaciones»/,
    });
    expect(boton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(boton);
    // Antes de que responda el servidor.
    expect(boton).toHaveAttribute("aria-pressed", "true");
    expect(boton).toHaveAccessibleName(/4 votos/);
    expect(servicio.votar).toHaveBeenCalledWith(10);
    respuesta.resolver({ vote_count: 7, voted_by_me: true });
    await waitFor(() => expect(boton).toHaveAccessibleName(/7 votos/));
  });

  it("si falla, vuelve a como estaba y lo avisa", async () => {
    servicio.votar.mockRejectedValue(errorApi(500, "Sin conexión."));
    pintar();
    const boton = await screen.findByRole("button", {
      name: /Votar por «Digitalizar/,
    });
    fireEvent.click(boton);
    expect(await screen.findByText("Sin conexión.")).toBeInTheDocument();
    expect(boton).toHaveAttribute("aria-pressed", "false");
    expect(boton).toHaveAccessibleName(/3 votos/);
  });

  it("quitar el voto usa DELETE (idempotente)", async () => {
    pintar();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Votar por «Tablero de clima laboral»/,
      }),
    );
    await waitFor(() => expect(servicio.quitarVoto).toHaveBeenCalledWith(11));
    expect(servicio.votar).not.toHaveBeenCalled();
  });
});

// --- Formulario -----------------------------------------------------------------

async function abrirFormulario() {
  pintar();
  fireEvent.click(await screen.findByRole("button", { name: /Proponer idea/ }));
  return screen.findByRole("dialog", { name: "Proponer una idea de mejora" });
}

const archivo = (nombre, bytes, tipo = "application/pdf") => {
  const f = new File(["x"], nombre, { type: tipo });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
};

describe("Proponer idea", () => {
  it("las reglas del adjunto son las de me/", () => {
    expect(problemaDelAdjunto(archivo("a.exe", 10))).toMatch(
      /Formato no admitido/,
    );
    expect(problemaDelAdjunto(archivo("a.PDF", 10))).toBeNull();
    expect(problemaDelAdjunto(archivo("a.pdf", 9 * 1024 * 1024))).toBe(
      "El archivo pesa 9 MB: el máximo es 8 MB.",
    );
  });

  it("rechaza un adjunto de formato no admitido o demasiado grande", async () => {
    const ventana = await abrirFormulario();
    const campo = within(ventana).getByLabelText("Archivo adjunto (opcional)");
    fireEvent.change(campo, { target: { files: [archivo("virus.exe", 10)] } });
    expect(
      await within(ventana).findByText(/Formato no admitido\. Use DOC, DOCX/),
    ).toBeInTheDocument();
    expect(campo).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(campo, {
      target: { files: [archivo("grande.pdf", 9 * 1024 * 1024)] },
    });
    expect(
      await within(ventana).findByText(
        "El archivo pesa 9 MB: el máximo es 8 MB.",
      ),
    ).toBeInTheDocument();
    expect(within(ventana).queryByText("grande.pdf")).not.toBeInTheDocument();
  });

  it("pide título y descripción antes de enviar", async () => {
    const ventana = await abrirFormulario();
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Proponer idea/ }),
    );
    expect(
      await within(ventana).findByText("Escriba un título para la idea."),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText(
        "Describa el problema y la mejora que propone.",
      ),
    ).toBeInTheDocument();
    expect(servicio.proponer).not.toHaveBeenCalled();
  });

  it("envía con el adjunto y la idea aparece en el tablero", async () => {
    const ventana = await abrirFormulario();
    fireEvent.change(within(ventana).getByLabelText(/^Título/), {
      target: { value: "Firmas digitales" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Descripción/), {
      target: { value: "Evitar imprimir contratos." },
    });
    fireEvent.click(within(ventana).getByRole("radio", { name: "Bajo" }));
    const adjunto = archivo("propuesta.pdf", 2048);
    fireEvent.change(
      within(ventana).getByLabelText("Archivo adjunto (opcional)"),
      { target: { files: [adjunto] } },
    );
    // Elegido: se muestra con su botón «Quitar».
    expect(
      await within(ventana).findByRole("button", {
        name: "Quitar propuesta.pdf",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Proponer idea/ }),
    );
    expect(
      await screen.findByText(/Idea «Firmas digitales» propuesta/),
    ).toBeInTheDocument();
    expect(servicio.proponer).toHaveBeenCalledWith({
      title: "Firmas digitales",
      description: "Evitar imprimir contratos.",
      impact: "BAJO",
      archivo: adjunto,
    });
    expect(
      screen.getByRole("link", { name: "Firmas digitales" }),
    ).toBeInTheDocument();
  });

  it("muestra el motivo del servidor en el campo del adjunto", async () => {
    servicio.proponer.mockRejectedValue(
      errorApi(
        400,
        "El contenido no corresponde a un PDF.",
        "validation_error",
        {
          attachment: ["El contenido no corresponde a un PDF."],
        },
      ),
    );
    const ventana = await abrirFormulario();
    fireEvent.change(within(ventana).getByLabelText(/^Título/), {
      target: { value: "Idea" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Descripción/), {
      target: { value: "Texto" },
    });
    fireEvent.change(
      within(ventana).getByLabelText("Archivo adjunto (opcional)"),
      { target: { files: [archivo("falso.pdf", 100)] } },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Proponer idea/ }),
    );
    await waitFor(() =>
      expect(
        within(ventana).getByLabelText("Archivo adjunto (opcional)"),
      ).toHaveAttribute("aria-invalid", "true"),
    );
    expect(
      screen.getByRole("dialog", { name: "Proponer una idea de mejora" }),
    ).toBeInTheDocument();
  });
});

// --- Detalle ------------------------------------------------------------------

describe("Detalle de una idea", () => {
  it("muestra descripción, historial y abre el PDF en el visor interno", async () => {
    pintar(DETALLE);
    expect(
      await screen.findByRole("heading", {
        name: "Digitalizar las solicitudes de vacaciones",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hoy se llenan en papel/)).toBeInTheDocument();
    expect(screen.getByText("Revisemos.")).toBeInTheDocument();
    expect(screen.queryByText("Gestionar la idea")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ver propuesta\.pdf/ }));
    expect(
      await screen.findByRole("dialog", { name: "propuesta.pdf" }),
    ).toBeInTheDocument();
    expect(descargar).toHaveBeenCalledWith(
      "/mejora-continua/ideas/10/attachment/",
    );
    expect(descargarBlob).not.toHaveBeenCalled();
  });

  it("un Word se descarga con ?download=1", async () => {
    servicio.obtener.mockResolvedValue(
      detalle({
        attachment: {
          name: "plan.docx",
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 1000,
          viewer: null,
          url: "/mejora-continua/ideas/10/attachment/",
        },
      }),
    );
    pintar(DETALLE);
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar plan\.docx/ }),
    );
    await waitFor(() =>
      expect(descargar).toHaveBeenCalledWith(
        "/mejora-continua/ideas/10/attachment/?download=1",
      ),
    );
  });

  it("una idea que no existe o no se ve (404)", async () => {
    servicio.obtener.mockRejectedValue(
      errorApi(404, "Idea no encontrada.", "not_found"),
    );
    pintar(DETALLE);
    expect(
      await screen.findByText(/No se encontró la idea o no tiene acceso/),
    ).toBeInTheDocument();
  });
});

// --- Gestión: etapas y avance ---------------------------------------------------

function comoGestor(extra = {}) {
  usar(ME_GESTOR);
  servicio.obtener.mockResolvedValue(
    detalle({
      status: "EN_REVISION",
      status_label: "En revisión",
      can_manage: true,
      allowed_actions: ["ADVANCE", "RETREAT", "REJECT"],
      ...extra,
    }),
  );
}

describe("Acciones de etapa", () => {
  it("avanzar manda la etapa vista y muestra la nueva", async () => {
    comoGestor();
    servicio.cambiarEtapa.mockResolvedValue(
      detalle({
        status: "APROBADA",
        status_label: "Aprobada",
        can_manage: true,
        allowed_actions: ["ADVANCE", "RETREAT", "REJECT"],
      }),
    );
    pintar(DETALLE);
    fireEvent.click(
      await screen.findByRole("button", { name: /Avanzar a «Aprobada»/ }),
    );
    expect(
      await screen.findByText("La idea pasó a «Aprobada»."),
    ).toBeInTheDocument();
    expect(servicio.cambiarEtapa).toHaveBeenCalledWith(10, {
      action: "ADVANCE",
      comment: null,
      expectedStatus: "EN_REVISION",
    });
    expect(
      screen.getByRole("button", { name: /Retroceder a «En revisión»/ }),
    ).toBeInTheDocument();
  });

  it("rechazar exige el motivo", async () => {
    comoGestor();
    servicio.cambiarEtapa.mockResolvedValue(
      detalle({
        status: "RECHAZADA",
        status_label: "Rechazada",
        can_manage: true,
        allowed_actions: ["REOPEN"],
      }),
    );
    pintar(DETALLE);
    fireEvent.click(await screen.findByRole("button", { name: /^Rechazar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar rechazo" }));
    expect(
      await screen.findByText("El motivo del rechazo es obligatorio."),
    ).toBeInTheDocument();
    expect(servicio.cambiarEtapa).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Motivo del rechazo/), {
      target: { value: "Fuera de alcance." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar rechazo" }));
    await waitFor(() =>
      expect(servicio.cambiarEtapa).toHaveBeenCalledWith(10, {
        action: "REJECT",
        comment: "Fuera de alcance.",
        expectedStatus: "EN_REVISION",
      }),
    );
    expect(
      await screen.findByRole("button", { name: /Reabrir/ }),
    ).toBeInTheDocument();
  });

  it("409: avisa que alguien ya la movió y recarga la idea", async () => {
    comoGestor();
    servicio.cambiarEtapa.mockRejectedValue(
      errorApi(
        409,
        "La idea ya está en «Aprobada»: alguien la movió. Actualice la pantalla.",
        "conflict",
        { status: ["APROBADA"] },
      ),
    );
    pintar(DETALLE);
    const avanzar = await screen.findByRole("button", {
      name: /Avanzar a «Aprobada»/,
    });
    servicio.obtener.mockResolvedValue(
      detalle({
        status: "APROBADA",
        status_label: "Aprobada",
        can_manage: true,
        allowed_actions: ["ADVANCE", "RETREAT", "REJECT"],
      }),
    );
    fireEvent.click(avanzar);
    expect(
      await screen.findByText(/alguien la movió.*Se recargó la idea/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Avanzar a «En desarrollo»/ }),
    ).toBeInTheDocument();
    expect(servicio.obtener).toHaveBeenCalledTimes(2);
  });

  it("una implementada no ofrece acciones", async () => {
    comoGestor({
      status: "IMPLEMENTADA",
      status_label: "Implementada",
      allowed_actions: [],
    });
    pintar(DETALLE);
    expect(
      await screen.findByText(/es la etapa final y ya no se mueve/),
    ).toBeInTheDocument();
  });

  it("guarda el avance y valida el rango 0–100", async () => {
    comoGestor({ status: "EN_DESARROLLO", status_label: "En desarrollo" });
    servicio.actualizarAvance.mockResolvedValue(
      detalle({
        status: "EN_DESARROLLO",
        status_label: "En desarrollo",
        progress: 60,
        can_manage: true,
        allowed_actions: ["ADVANCE", "RETREAT", "REJECT"],
      }),
    );
    pintar(DETALLE);
    const campo = await screen.findByLabelText("Avance (%)");
    fireEvent.change(campo, { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar avance" }));
    expect(
      await screen.findByText(
        "El avance debe ser un número entero entre 0 y 100.",
      ),
    ).toBeInTheDocument();
    expect(servicio.actualizarAvance).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar avance" }));
    expect(
      await screen.findByText("Avance actualizado a 60%."),
    ).toBeInTheDocument();
    expect(servicio.actualizarAvance).toHaveBeenCalledWith(10, 60);
    expect(screen.getByRole("progressbar", { name: "Avance" })).toHaveAttribute(
      "aria-valuenow",
      "60",
    );
  });
});

// --- Correcciones de la auditoría UX/UI ------------------------------------------

const leer = (relativa) =>
  readFileSync(path.resolve(__dirname, "..", relativa), "utf8");
const regla = (hoja, selector) => {
  const i = hoja.indexOf(`${selector} {`);
  expect(i).toBeGreaterThan(-1);
  return hoja.slice(i, hoja.indexOf("}", i));
};

describe("Auditoría: estilos", () => {
  it("el tablero contiene sus textos ocultos (sin desbordar la página)", () => {
    // jsdom no calcula el diseño: se revisa la hoja. Sin `position:
    // relative`, los `visually-hidden` (absolute) de las columnas fuera de
    // vista escapaban del desplazamiento del tablero.
    const hoja = leer(
      "src/pages/GestionHumana/MejoraContinua/MejoraContinua.css",
    );
    expect(regla(hoja, ".mc-tablero")).toContain("position: relative");
    expect(regla(hoja, ".mc-tablero")).toContain("overflow-x: auto");
  });

  it("las casillas de toda la intranet usan el borde de control (3:1)", () => {
    const marca = leer("src/styles/marca.css");
    expect(regla(marca, ".form-check-input")).toContain(
      "border-color: var(--marca-borde-control)",
    );
    // Marcadas siguen con el color de acción (regla más específica).
    expect(leer("src/styles/identidad-puente.css")).toContain(
      ".form-check-input:checked {",
    );
  });
});

describe("Auditoría: tablero", () => {
  it("pestaña y filtros vienen de la URL", async () => {
    pintar(`${TABLERO}?vista=mias&ocultar=1`);
    await waitFor(() =>
      expect(servicio.listar).toHaveBeenCalledWith({ soloMias: true }),
    );
    expect(
      await screen.findByRole("checkbox", { name: "Ocultar rechazadas" }),
    ).toBeChecked();
    expect(screen.getByRole("tab", { name: /Mis ideas/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("al volver del detalle, el foco vuelve a la idea abierta", async () => {
    render(
      <MemoryRouter
        initialEntries={[{ pathname: TABLERO, state: { desde: 10 } }]}
      >
        <Routes>
          <Route path="/admin/gestion-humana" element={<MarcoMejoraContinua />}>
            <Route path="mejora-continua" element={<MejoraContinua />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const enlace = await screen.findByRole("link", {
      name: "Digitalizar las solicitudes de vacaciones",
    });
    await waitFor(() => expect(enlace).toHaveFocus());
  });

  it("el tablero es una región con foco y las etapas vacías van compactas", async () => {
    pintar();
    const tablero = await screen.findByRole("region", {
      name: "Tablero de ideas",
    });
    expect(tablero).toHaveAttribute("tabindex", "0");
    expect(columna("Aprobada")).toHaveClass("mc-columna--vacia");
    expect(columna("Propuesta")).not.toHaveClass("mc-columna--vacia");
  });

  it("el impacto no usa los colores de las etapas", async () => {
    pintar();
    await screen.findByRole("link", { name: "Encuesta de salida" });
    for (const texto of ["Impacto alto", "Impacto medio", "Impacto bajo"]) {
      // El texto también es una opción del filtro: solo las píldoras.
      const pildoras = screen
        .getAllByText(texto)
        .map((n) => n.closest(".mz-pill"))
        .filter(Boolean);
      expect(pildoras.length).toBeGreaterThan(0);
      for (const p of pildoras)
        expect(p.className).not.toMatch(/mz-pill--(ok|warn|bad)/);
    }
  });
});

describe("Auditoría: detalle", () => {
  it("«Volver» conserva los filtros del tablero y dice de qué idea se viene", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: DETALLE, state: { volverA: "?impacto=ALTO" } },
        ]}
      >
        <Routes>
          <Route path="/admin/gestion-humana" element={<MarcoMejoraContinua />}>
            <Route path="mejora-continua/:ideaId" element={<DetalleIdea />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("link", { name: /Volver a Mejora continua/ }),
    ).toHaveAttribute("href", `${TABLERO}?impacto=ALTO`);
  });

  it("cancelar el rechazo (botón o Escape) devuelve el foco a «Rechazar»", async () => {
    comoGestor();
    pintar(DETALLE);
    const rechazar = await screen.findByRole("button", { name: /^Rechazar/ });
    fireEvent.click(rechazar);
    // Con el motivo abierto no se puede avanzar ni retroceder.
    expect(
      screen.getByRole("button", { name: /Avanzar a «Aprobada»/ }),
    ).toBeDisabled();
    expect(screen.getByText(/0 de 2000 caracteres/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(rechazar).toHaveFocus());
    fireEvent.click(rechazar);
    fireEvent.keyDown(screen.getByLabelText(/Motivo del rechazo/), {
      key: "Escape",
    });
    await waitFor(() => expect(rechazar).toHaveFocus());
    expect(
      screen.queryByLabelText(/Motivo del rechazo/),
    ).not.toBeInTheDocument();
  });

  it("un error del avance lleva el foco al campo; fuera de desarrollo no se edita", async () => {
    comoGestor({ status: "EN_DESARROLLO", status_label: "En desarrollo" });
    servicio.actualizarAvance.mockRejectedValue(
      errorApi(400, "El avance debe estar entre 0 y 100.", "validation_error", {
        progress: ["El avance debe estar entre 0 y 100."],
      }),
    );
    pintar(DETALLE);
    const campo = await screen.findByLabelText("Avance (%)");
    fireEvent.change(campo, { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar avance" }));
    await waitFor(() => expect(campo).toHaveFocus());
    fireEvent.change(campo, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar avance" }));
    expect(
      await screen.findByText("El avance debe estar entre 0 y 100."),
    ).toBeInTheDocument();
    await waitFor(() => expect(campo).toHaveFocus());
  });

  it("en revisión, el avance no se edita", async () => {
    comoGestor();
    pintar(DETALLE);
    expect(
      await screen.findByText(
        /El avance se registra mientras la idea está en desarrollo/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Avance (%)")).not.toBeInTheDocument();
  });
});

describe("Auditoría en vivo: columnas y tarjetas", () => {
  it("las columnas con ideas no bajan de 240 px; el contador no se parte; el título corta solo palabras largas", () => {
    const hoja = leer(
      "src/pages/GestionHumana/MejoraContinua/MejoraContinua.css",
    );
    expect(regla(hoja, ".mc-columna")).toContain("flex: 1 0 240px");
    expect(regla(hoja, ".mc-columna__cuenta")).toContain("white-space: nowrap");
    const titulo = regla(hoja, ".mc-tarjeta__titulo");
    expect(titulo).toContain("overflow-wrap: break-word");
    expect(titulo).not.toContain("anywhere");
  });

  it("«Mi idea» va con el impacto, no junto al título", async () => {
    pintar();
    const desarrollo = await screen.findByRole("region", {
      name: /^En desarrollo/,
    });
    const miIdea = within(desarrollo).getByText("Mi idea");
    expect(miIdea.closest(".mz-pill-row")).toHaveTextContent("Impacto medio");
  });
});
