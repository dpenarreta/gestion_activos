import { readFileSync } from "node:fs";
import path from "node:path";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ME_ADMIN,
  ME_INVITADO,
  errorApi,
  reunion,
  servicioFalso,
} from "./gestionHumanaReunionesDatos";

/*
 * Reuniones de Gestión Humana: el menú y los permisos, el listado (próximas
 * y pasadas por `timing`, filtros en la URL, vacío, error, sin permiso de
 * crear, «Todas» solo para quien administra), el formulario (validaciones,
 * enlace https, buscador de invitados, errores por campo) y el detalle
 * («Unirse» seguro, copiar la clave, asistencia, estado, Otter, editar y
 * eliminar con confirmación, 404). Los servicios van simulados.
 */

const servicio = servicioFalso();
vi.mock("../src/api/reunionesService", async (importOriginal) => ({
  ...(await importOriginal()),
  reunionesService: servicio,
}));
const confirmar = vi.fn();
vi.mock("../src/components/common/Confirmar/confirmar", () => ({
  confirmar: (...a) => confirmar(...a),
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: [] } }),
}));

const { MarcoReuniones } =
  await import("../src/pages/GestionHumana/Reuniones/ContextoReuniones");
const { Reuniones } =
  await import("../src/pages/GestionHumana/Reuniones/Reuniones");
const { DetalleReunion } =
  await import("../src/pages/GestionHumana/Reuniones/DetalleReunion");
const { getVisibleAdminMenu } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");
const { PERMISOS_GESTION_HUMANA } =
  await import("../src/modulos/permisosGestionHumana");
const { esEnlaceSeguro, duracionEnTexto } =
  await import("../src/pages/GestionHumana/Reuniones/reunionesComunes");

const LISTADO = "/admin/gestion-humana/reuniones";
const DETALLE = `${LISTADO}/10`;

function Ubicacion() {
  const l = useLocation();
  return <output data-testid="ubicacion">{`${l.pathname}${l.search}`}</output>;
}

function pintar(ruta = LISTADO) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/admin/gestion-humana" element={<MarcoReuniones />}>
          <Route path="reuniones" element={<Reuniones />} />
          <Route path="reuniones/:reunionId" element={<DetalleReunion />} />
        </Route>
      </Routes>
      <Ubicacion />
    </MemoryRouter>,
  );
}

function usar(me) {
  Object.assign(servicio, servicioFalso(me));
}

beforeEach(() => {
  usar(undefined);
  confirmar.mockReset();
});

// --- Menú y permisos ------------------------------------------------------------

const hojas = (items) =>
  items.flatMap((i) => [...(i.path ? [i] : []), ...hojas(i.children ?? [])]);
const entradas = (permisos) =>
  hojas(getVisibleAdminMenu(permisos, "gestion_humana")).map((i) => i.id);

describe("Reuniones en el menú", () => {
  it("aparece con cualquiera de los tres permisos", () => {
    for (const p of [
      "reuniones.acceder",
      "reuniones.crear",
      "reuniones.administrar",
    ])
      expect(entradas([p])).toContain("gh-reuniones");
  });

  it("no aparece sin permisos de Reuniones", () => {
    expect(entradas(["tareas.acceder"])).not.toContain("gh-reuniones");
  });

  it("los permisos de Reuniones abren el módulo Gestión Humana", () => {
    for (const p of [
      "reuniones.acceder",
      "reuniones.crear",
      "reuniones.administrar",
    ])
      expect(PERMISOS_GESTION_HUMANA).toContain(p);
  });

  it("cuelga de «Tareas y equipo»", () => {
    const grupo = getVisibleAdminMenu(
      ["reuniones.acceder", "tareas.acceder"],
      "gestion_humana",
    ).find((i) => i.id === "gh-tareas-equipo");
    expect(grupo.children.map((h) => h.id)).toContain("gh-reuniones");
  });
});

// --- Listado ------------------------------------------------------------------

describe("Listado de reuniones", () => {
  it("Próximas muestra las que vienen y la que está en su horario", async () => {
    pintar();
    expect(
      await screen.findByRole("link", { name: "Revisión semanal" }),
    ).toHaveAttribute("href", DETALLE);
    expect(
      screen.getByRole("link", { name: "Comité en curso" }),
    ).toBeInTheDocument();
    expect(screen.getByText("En su horario ahora")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Cierre de octubre" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("2 reuniones")).toHaveAttribute("role", "status");
    // «Unirse» abre en otra pestaña, sin darle acceso a la intranet.
    const unirse = screen.getAllByRole("link", { name: /^Unirse/ })[0];
    expect(unirse).toHaveAttribute("target", "_blank");
    expect(unirse).toHaveAttribute("rel", "noopener noreferrer");
    expect(unirse).toHaveAttribute("href", "https://zoom.us/j/123");
  });

  it("Pasadas muestra solo las que ya pasaron y queda en la URL", async () => {
    pintar();
    await screen.findByRole("link", { name: "Revisión semanal" });
    fireEvent.click(screen.getByRole("tab", { name: /Pasadas/ }));
    expect(
      await screen.findByRole("link", { name: "Cierre de octubre" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Revisión semanal" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("ubicacion")).toHaveTextContent("vista=pasadas");
    // En las pasadas no hay «Unirse».
    expect(
      screen.queryByRole("link", { name: /^Unirse/ }),
    ).not.toBeInTheDocument();
  });

  it("el filtro de estado se pide al servidor", async () => {
    pintar();
    await screen.findByRole("link", { name: "Revisión semanal" });
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
      target: { value: "FINALIZADA" },
    });
    await waitFor(() =>
      expect(servicio.listar).toHaveBeenLastCalledWith({
        scope: "",
        status: "FINALIZADA",
      }),
    );
  });

  it("«Todas las de la empresa» solo para quien administra", async () => {
    pintar(`${LISTADO}?alcance=all`);
    await screen.findByRole("link", { name: "Revisión semanal" });
    // Sin `administrar`, un enlace con `alcance=all` no se manda.
    expect(servicio.listar).toHaveBeenCalledWith({ scope: "", status: "" });
    expect(
      screen.queryByRole("option", { name: "Todas las de la empresa" }),
    ).not.toBeInTheDocument();
  });

  it("quien administra puede ver todas", async () => {
    usar(ME_ADMIN);
    pintar();
    await screen.findByRole("link", { name: "Revisión semanal" });
    fireEvent.change(screen.getByLabelText("Qué reuniones ver"), {
      target: { value: "all" },
    });
    await waitFor(() =>
      expect(servicio.listar).toHaveBeenLastCalledWith({
        scope: "all",
        status: "",
      }),
    );
  });

  it("vacío: invita a programar la primera", async () => {
    servicio.listar.mockResolvedValue([]);
    pintar();
    expect(
      await screen.findByText("No tiene reuniones próximas."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Programar una reunión" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Programar una reunión" }),
    ).toBeInTheDocument();
  });

  it("un error se muestra con Reintentar", async () => {
    servicio.listar.mockRejectedValueOnce(errorApi(500, "Falló el servidor."));
    pintar();
    expect(await screen.findByText("Falló el servidor.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("link", { name: "Revisión semanal" }),
    ).toBeInTheDocument();
  });

  it("sin permiso de crear no se ofrece programar", async () => {
    usar(ME_INVITADO);
    pintar();
    await screen.findByRole("link", { name: "Revisión semanal" });
    expect(
      screen.queryByRole("button", { name: /Programar reunión/ }),
    ).not.toBeInTheDocument();
  });

  it("sin acceso (403) lo dice", async () => {
    servicio.yo.mockRejectedValue(
      errorApi(403, "No tiene permiso.", "permission_denied"),
    );
    pintar();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tiene permiso.",
    );
  });
});

// --- Formulario -----------------------------------------------------------------

async function abrirFormulario() {
  pintar();
  fireEvent.click(
    await screen.findByRole("button", { name: /Programar reunión/ }),
  );
  return screen.findByRole("dialog", { name: "Programar una reunión" });
}

describe("Programar una reunión", () => {
  it("valida título, duración y que el enlace sea https", async () => {
    const ventana = await abrirFormulario();
    fireEvent.change(within(ventana).getByLabelText(/^Duración/), {
      target: { value: "0" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Enlace de la reunión/), {
      target: { value: "http://zoom.us/j/1" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Programar reunión/ }),
    );
    const titulo = within(ventana).getByLabelText(/^Título/);
    await waitFor(() => expect(titulo).toHaveFocus());
    expect(titulo).toHaveAttribute("aria-invalid", "true");
    expect(
      within(ventana).getByLabelText(/^Duración/),
    ).toHaveAccessibleDescription(/entre 1 y 1440/);
    expect(
      within(ventana).getByLabelText(/^Enlace de la reunión/),
    ).toHaveAccessibleDescription(/tiene que empezar con https:\/\//);
    expect(servicio.crear).not.toHaveBeenCalled();
  });

  it("busca invitados en el servidor y manda la reunión completa", async () => {
    const ventana = await abrirFormulario();
    await within(ventana).findByText("2 personas encontradas.");
    fireEvent.change(
      within(ventana).getByLabelText("Buscar personas para invitar"),
      {
        target: { value: "mar" },
      },
    );
    await waitFor(() =>
      expect(servicio.invitables).toHaveBeenLastCalledWith("mar"),
    );
    fireEvent.click(
      within(ventana).getByRole("checkbox", { name: /Luis Pérez/ }),
    );
    expect(
      within(ventana).getByRole("button", { name: /Quitar Luis Pérez/ }),
    ).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText(/^Título/), {
      target: { value: "Planificación" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Fecha y hora/), {
      target: { value: "2026-12-01T10:00" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "1 h" }));
    fireEvent.change(within(ventana).getByLabelText(/^Enlace de la reunión/), {
      target: { value: "https://teams.microsoft.com/l/abc" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Programar reunión/ }),
    );
    await waitFor(() => expect(servicio.crear).toHaveBeenCalled());
    expect(servicio.crear).toHaveBeenCalledWith({
      title: "Planificación",
      meeting_date: new Date("2026-12-01T10:00").toISOString(),
      duration: 60,
      description: null,
      join_url: "https://teams.microsoft.com/l/abc",
      join_password: null,
      invitee_ids: [2],
    });
    expect(
      await screen.findByText(/Reunión «Planificación» programada/),
    ).toBeInTheDocument();
  });

  it("el motivo del servidor va bajo su campo y lo enfoca", async () => {
    servicio.crear.mockRejectedValue(
      errorApi(400, "El enlace no puede tener espacios.", "validation_error", {
        join_url: ["El enlace no puede tener espacios."],
      }),
    );
    const ventana = await abrirFormulario();
    fireEvent.change(within(ventana).getByLabelText(/^Título/), {
      target: { value: "Reunión" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Programar reunión/ }),
    );
    const enlace = within(ventana).getByLabelText(/^Enlace de la reunión/);
    await waitFor(() => expect(enlace).toHaveFocus());
    expect(enlace).toHaveAttribute("aria-invalid", "true");
  });
});

// --- Detalle ------------------------------------------------------------------

describe("Detalle de una reunión", () => {
  it("muestra horario, anfitrión, descripción, invitados y la clave", async () => {
    pintar(DETALLE);
    expect(
      await screen.findByRole("heading", { name: "Revisión semanal" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.getByText("45 min")).toBeInTheDocument();
    expect(screen.getByText("clave-1")).toBeInTheDocument();
    expect(screen.getByText("1 de 2 asistieron")).toBeInTheDocument();
  });

  it("copia la clave y lo anuncia", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    pintar(DETALLE);
    fireEvent.click(
      await screen.findByRole("button", { name: /Copiar clave/ }),
    );
    expect(writeText).toHaveBeenCalledWith("clave-1");
    expect(await screen.findByText("Clave copiada.")).toBeInTheDocument();
  });

  it("un enlace que no es https no se ofrece para unirse", async () => {
    servicio.obtener.mockResolvedValue(
      reunion({ join_url: "javascript:alert(1)" }),
    );
    pintar(DETALLE);
    await screen.findByRole("heading", { name: "Revisión semanal" });
    expect(
      screen.queryByRole("link", { name: /^Unirse/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Quien organiza todavía no ha puesto el enlace."),
    ).toBeInTheDocument();
  });

  it("el anfitrión marca la asistencia y manda solo lo que cambió", async () => {
    pintar(DETALLE);
    const luis = await screen.findByRole("checkbox", { name: /Luis Pérez/ });
    const guardar = screen.getByRole("button", { name: "Guardar asistencia" });
    expect(guardar).toBeDisabled();
    fireEvent.click(luis);
    fireEvent.click(guardar);
    await waitFor(() =>
      expect(servicio.marcarAsistencia).toHaveBeenCalledWith(10, [
        { user_id: 2, attended: true },
      ]),
    );
    expect(await screen.findByText("Asistencia guardada.")).toBeInTheDocument();
    expect(screen.getByText("2 de 2 asistieron")).toBeInTheDocument();
  });

  it("el anfitrión cambia el estado", async () => {
    pintar(DETALLE);
    const finalizada = await screen.findByRole("button", {
      name: /Finalizada/,
    });
    expect(finalizada).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(finalizada);
    await waitFor(() =>
      expect(servicio.editar).toHaveBeenCalledWith(10, {
        status: "FINALIZADA",
      }),
    );
    expect(
      await screen.findByText("La reunión quedó «Finalizada»."),
    ).toBeInTheDocument();
  });

  it("guarda lo de Otter y rechaza una transcripción sin https", async () => {
    pintar(DETALLE);
    const resumen = await screen.findByRole("textbox", { name: "Resumen" });
    fireEvent.change(resumen, { target: { value: "Se acordó X." } });
    const enlace = screen.getByLabelText("Enlace a la transcripción");
    fireEvent.change(enlace, { target: { value: "ftp://otter.ai/t" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar resumen" }));
    await waitFor(() => expect(enlace).toHaveFocus());
    expect(enlace).toHaveAttribute("aria-invalid", "true");
    expect(servicio.editar).not.toHaveBeenCalled();
    fireEvent.change(enlace, { target: { value: "https://otter.ai/t/1" } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Se invitó a Otter/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar resumen" }));
    await waitFor(() =>
      expect(servicio.editar).toHaveBeenCalledWith(10, {
        otter_invited: true,
        otter_summary: "Se acordó X.",
        otter_transcript_url: "https://otter.ai/t/1",
      }),
    );
  });

  it("quien solo está invitado no ve controles", async () => {
    servicio.obtener.mockResolvedValue(
      reunion({
        is_host: false,
        can_edit: false,
        otter_summary: "Resumen listo.",
        otter_transcript_url: "https://otter.ai/t/9",
      }),
    );
    pintar(DETALLE);
    await screen.findByRole("heading", { name: "Revisión semanal" });
    for (const nombre of [/^Editar/, /^Eliminar/, "Guardar asistencia"])
      expect(
        screen.queryByRole("button", { name: nombre }),
      ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Resumen listo.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Ver la transcripción/ }),
    ).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("editar manda solo lo que cambió (y los invitados completos si cambian)", async () => {
    pintar(DETALLE);
    fireEvent.click(await screen.findByRole("button", { name: /^Editar/ }));
    const ventana = await screen.findByRole("dialog", {
      name: "Editar la reunión",
    });
    fireEvent.change(within(ventana).getByLabelText(/^Título/), {
      target: { value: "Revisión quincenal" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Quitar Marta Ríos/ }),
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Guardar cambios/ }),
    );
    await waitFor(() =>
      expect(servicio.editar).toHaveBeenCalledWith(10, {
        title: "Revisión quincenal",
        invitee_ids: [2],
      }),
    );
  });

  it("eliminar pide confirmación y vuelve al listado con el aviso", async () => {
    confirmar.mockResolvedValue(true);
    pintar(DETALLE);
    fireEvent.click(await screen.findByRole("button", { name: /^Eliminar/ }));
    await waitFor(() => expect(servicio.eliminar).toHaveBeenCalledWith(10));
    expect(confirmar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "Eliminar reunión" }),
    );
    expect(
      await screen.findByText(/Reunión «Revisión semanal» eliminada/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ubicacion")).toHaveTextContent(LISTADO);
  });

  it("sin confirmar no elimina", async () => {
    confirmar.mockResolvedValue(false);
    pintar(DETALLE);
    fireEvent.click(await screen.findByRole("button", { name: /^Eliminar/ }));
    await waitFor(() => expect(confirmar).toHaveBeenCalled());
    expect(servicio.eliminar).not.toHaveBeenCalled();
  });

  it("una reunión ajena o eliminada (404) lo dice", async () => {
    servicio.obtener.mockRejectedValue(
      errorApi(404, "Reunión no encontrada.", "not_found"),
    );
    pintar(DETALLE);
    expect(
      await screen.findByText(/No se encontró la reunión/),
    ).toBeInTheDocument();
  });

  it("«Volver» conserva los filtros del listado", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: DETALLE, state: { volverA: "?vista=pasadas" } },
        ]}
      >
        <Routes>
          <Route path="/admin/gestion-humana" element={<MarcoReuniones />}>
            <Route path="reuniones/:reunionId" element={<DetalleReunion />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("link", { name: /Volver a Reuniones/ }),
    ).toHaveAttribute("href", `${LISTADO}?vista=pasadas`);
  });
});

// --- Correcciones de la auditoría UX/UI -----------------------------------------

describe("Auditoría: Reuniones", () => {
  it("«Unirse» dice adónde lleva: dominio con candado y en el nombre accesible", async () => {
    pintar(DETALLE);
    const unirse = await screen.findByRole("link", {
      name: "Unirse a «Revisión semanal» en zoom.us (se abre en una pestaña nueva)",
    });
    expect(unirse.closest(".re-externo")).toHaveTextContent("zoom.us");
    // Uno solo, el del encabezado: «Cómo entrar» ofrece copiar el enlace.
    expect(screen.getAllByRole("link", { name: /^Unirse/ })).toHaveLength(1);
  });

  it("«Copiar enlace» copia la dirección de la reunión", async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    pintar(DETALLE);
    fireEvent.click(
      await screen.findByRole("button", { name: /Copiar enlace/ }),
    );
    expect(writeText).toHaveBeenCalledWith("https://zoom.us/j/123");
    expect(await screen.findByText("Enlace copiado.")).toBeInTheDocument();
  });

  it("el enlace de la transcripción también dice su dominio", async () => {
    servicio.obtener.mockResolvedValue(
      reunion({
        can_edit: false,
        otter_summary: "Listo.",
        otter_transcript_url: "https://otter.ai/t/9",
      }),
    );
    pintar(DETALLE);
    expect(
      await screen.findByRole("link", {
        name: /Ver la transcripción en otter\.ai \(se abre en una pestaña nueva\)/,
      }),
    ).toBeInTheDocument();
  });

  it("el estado es un grupo de botones alternables, sin botón primario", async () => {
    pintar(DETALLE);
    const actual = await screen.findByRole("button", { name: /Programada/ });
    expect(actual).toHaveAttribute("aria-pressed", "true");
    expect(actual).toHaveClass("re-alternar");
    expect(actual).not.toHaveClass("btn-primary");
  });

  it("una pasada que sigue «Programada» se marca «Sin cerrar» para quien organiza", async () => {
    servicio.obtener.mockResolvedValue(reunion({ timing: "PAST" }));
    pintar(DETALLE);
    expect(await screen.findByText("Sin cerrar")).toBeInTheDocument();
  });

  it("sin «Sin cerrar» para quien solo está invitado", async () => {
    servicio.obtener.mockResolvedValue(
      reunion({ timing: "PAST", is_host: false, can_edit: false }),
    );
    pintar(DETALLE);
    await screen.findByRole("heading", { name: "Revisión semanal" });
    expect(screen.queryByText("Sin cerrar")).not.toBeInTheDocument();
  });

  it("«Guardar asistencia» deshabilitado dice por qué", async () => {
    pintar(DETALLE);
    const guardar = await screen.findByRole("button", {
      name: "Guardar asistencia",
    });
    expect(guardar).toHaveAccessibleDescription(
      "Marque o desmarque a alguien para guardar.",
    );
  });

  it("las dos pestañas llevan su número", async () => {
    pintar();
    expect(
      await screen.findByRole("tab", { name: /Próximas\s*2 reuniones/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Pasadas\s*1 reunión/ }),
    ).toBeInTheDocument();
  });

  it("las duraciones frecuentes van junto a su campo", async () => {
    const ventana = await abrirFormulario();
    const campo = within(ventana).getByLabelText(/^Duración/);
    const grupo = within(ventana).getByRole("group", {
      name: "Duraciones frecuentes",
    });
    expect(grupo.closest(".re-duracion")).toContainElement(campo);
    const media = within(grupo).getByRole("button", { name: "30 min" });
    expect(media).toHaveAttribute("aria-pressed", "true");
    expect(media).toHaveClass("re-alternar");
  });
});

// --- Utilidades y estilos -------------------------------------------------------

describe("Utilidades", () => {
  it("solo https con servidor es un enlace seguro", () => {
    expect(esEnlaceSeguro("https://meet.google.com/abc")).toBe(true);
    expect(esEnlaceSeguro("http://meet.google.com/abc")).toBe(false);
    expect(esEnlaceSeguro("javascript:alert(1)")).toBe(false);
    expect(esEnlaceSeguro("https://a b.com")).toBe(false);
    expect(esEnlaceSeguro("")).toBe(false);
  });

  it("la duración se lee en horas y minutos", () => {
    expect(duracionEnTexto(45)).toBe("45 min");
    expect(duracionEnTexto(60)).toBe("1 h");
    expect(duracionEnTexto(90)).toBe("1 h 30 min");
  });
});

const leer = (relativa) =>
  readFileSync(path.resolve(__dirname, "..", relativa), "utf8");

describe("Auditoría: estilos", () => {
  it("una columna en ≤ 880 px y objetivos de 44 px al tacto, solo con tokens", () => {
    const hoja = leer("src/pages/GestionHumana/Reuniones/Reuniones.css");
    expect(hoja).toContain("@media (max-width: 880px)");
    expect(hoja).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
    // Ningún color suelto: todo con los tokens de la identidad.
    const sinComentarios = hoja.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sinComentarios).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
