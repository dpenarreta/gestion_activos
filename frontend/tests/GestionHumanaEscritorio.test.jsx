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
  ME_SIN_TAREAS,
  NOTAS,
  RECORDATORIOS,
  errorApi,
  nota,
  recordatorio,
  servicioFalso,
} from "./gestionHumanaEscritorioDatos";

/*
 * Escritorio de Gestión Humana: el menú y los permisos, «Hoy», las notas
 * (pestañas, acciones, eliminar con confirmación y 409, abrir marca leída,
 * respuestas con tope y 409, convertir en recordatorio), la nota nueva
 * (validaciones, contador, adjunto según `me.attachment`), los recordatorios
 * (completar con 409, posponer con atajos, reabrir, convertir en tarea solo
 * con acceso a Tareas y su 409), el buscador y el contraste de los colores
 * de las notas. Los servicios van simulados.
 */

const servicio = servicioFalso();
vi.mock("../src/api/escritorioService", async (importOriginal) => ({
  ...(await importOriginal()),
  escritorioService: servicio,
}));
const confirmar = vi.fn();
vi.mock("../src/components/common/Confirmar/confirmar", () => ({
  confirmar: (...a) => confirmar(...a),
}));
const descargar = vi.fn();
vi.mock("../src/api/soporteService", () => ({
  soporteService: { descargar: (...a) => descargar(...a) },
}));
vi.mock("../src/components/common/VisorPdf/VisorPdf", () => ({
  MarcoPdf: () => <div />,
  useUrlDePdf: () => "blob:doc",
  VisorPdf: ({ titulo }) => <div role="dialog" aria-label={titulo} />,
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: [] } }),
}));

const { MarcoEscritorio } =
  await import("../src/pages/GestionHumana/Escritorio/ContextoEscritorio");
const { Escritorio } =
  await import("../src/pages/GestionHumana/Escritorio/Escritorio");
const { getVisibleAdminMenu } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");
const { PERMISOS_GESTION_HUMANA } =
  await import("../src/modulos/permisosGestionHumana");
const { textoDePosponer } =
  await import("../src/pages/GestionHumana/Escritorio/escritorioComunes");

const RUTA = "/admin/gestion-humana/escritorio";

function Ubicacion() {
  const l = useLocation();
  return <output data-testid="ubicacion">{l.search}</output>;
}

function pintar(busqueda = "") {
  return render(
    <MemoryRouter initialEntries={[`${RUTA}${busqueda}`]}>
      <Routes>
        <Route path="/admin/gestion-humana" element={<MarcoEscritorio />}>
          <Route path="escritorio" element={<Escritorio />} />
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
  descargar.mockReset();
  descargar.mockResolvedValue({ data: new Blob(["x"]) });
});

function archivo(nombre, bytes) {
  const f = new File(["x"], nombre);
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

// --- Menú y permisos ------------------------------------------------------------

const hojas = (items) =>
  items.flatMap((i) => [...(i.path ? [i] : []), ...hojas(i.children ?? [])]);

describe("Escritorio en el menú", () => {
  it("aparece con escritorio.acceder, con la insignia de notas sin leer", () => {
    const entrada = hojas(
      getVisibleAdminMenu(["escritorio.acceder"], "gestion_humana"),
    ).find((i) => i.id === "gh-escritorio");
    expect(entrada).toMatchObject({
      path: RUTA,
      insignia: "notas_sin_leer",
    });
  });

  it("no aparece sin el permiso", () => {
    expect(
      hojas(getVisibleAdminMenu(["tareas.acceder"], "gestion_humana")).map(
        (i) => i.id,
      ),
    ).not.toContain("gh-escritorio");
  });

  it("el permiso abre el módulo Gestión Humana", () => {
    expect(PERMISOS_GESTION_HUMANA).toContain("escritorio.acceder");
  });
});

// --- Hoy ------------------------------------------------------------------------

describe("Hoy", () => {
  it("muestra las notas sin leer, los recordatorios y las tareas; sin proyectos si no llegan", async () => {
    pintar();
    const notas = await screen.findByRole("region", { name: /Notas sin leer/ });
    expect(
      within(notas).getByText("Revise el informe de asistencia."),
    ).toBeInTheDocument();
    const recordatorios = screen.getByRole("region", {
      name: /Recordatorios de hoy/,
    });
    expect(within(recordatorios).getByText("Vencido")).toBeInTheDocument();
    const tareas = screen.getByRole("region", {
      name: /Tareas de esta semana/,
    });
    expect(
      within(tareas).getByRole("link", { name: "Cerrar nómina" }),
    ).toHaveAttribute("href", "/admin/gestion-humana/tareas/7");
    expect(
      screen.queryByRole("region", { name: /Proyectos/ }),
    ).not.toBeInTheDocument();
  });

  it("leer una nota desde Hoy la pide entera y la marca leída", async () => {
    pintar();
    fireEvent.click(
      await screen.findByRole("button", { name: /Leer la nota de Luis/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Nota de Luis Pérez" }),
    ).toBeInTheDocument();
    expect(servicio.obtenerNota).toHaveBeenCalledWith(20);
    await waitFor(() =>
      expect(servicio.accionDeNota).toHaveBeenCalledWith(20, "read"),
    );
    expect(servicio.sinLeer).toHaveBeenCalled();
  });

  it("un error se muestra con Reintentar", async () => {
    servicio.hoy.mockRejectedValueOnce(errorApi(500, "Falló el servidor."));
    pintar();
    expect(await screen.findByText("Falló el servidor.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("region", { name: /Notas sin leer/ }),
    ).toBeInTheDocument();
  });
});

// --- Notas ----------------------------------------------------------------------

describe("Notas", () => {
  it("lista los post-it con su prioridad y la cuenta de sin leer en la pestaña", async () => {
    pintar("?seccion=notas");
    expect(
      await screen.findByText("Revise el informe de asistencia."),
    ).toBeInTheDocument();
    expect(servicio.notas).toHaveBeenCalledWith("desk");
    expect(screen.getAllByText("Sin leer").length).toBeGreaterThan(0);
    expect(screen.getByText("1 de 2 respuestas")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Escritorio\s*1 sin leer/ }),
    ).toBeInTheDocument();
  });

  it("cada pestaña pide su vista y queda en la URL", async () => {
    pintar("?seccion=notas");
    await screen.findByText("Revise el informe de asistencia.");
    fireEvent.click(screen.getByRole("tab", { name: /Enviadas/ }));
    await waitFor(() =>
      expect(servicio.notas).toHaveBeenLastCalledWith("sent"),
    );
    expect(screen.getByTestId("ubicacion")).toHaveTextContent("vista=sent");
  });

  it("fijar y archivar: la archivada sale del escritorio", async () => {
    pintar("?seccion=notas");
    await screen.findByText("Revise el informe de asistencia.");
    const primera = screen
      .getByText("Revise el informe de asistencia.")
      .closest("li");
    fireEvent.click(within(primera).getByRole("button", { name: "Fijar" }));
    await waitFor(() =>
      expect(servicio.accionDeNota).toHaveBeenCalledWith(20, "pin"),
    );
    expect(await screen.findByText("Nota fijada arriba.")).toBeInTheDocument();
    fireEvent.click(within(primera).getByRole("button", { name: "Archivar" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Revise el informe de asistencia."),
      ).not.toBeInTheDocument(),
    );
    expect(servicio.sinLeer).toHaveBeenCalled();
  });

  it("en Archivadas se elimina con confirmación; un 409 se avisa", async () => {
    servicio.notas.mockResolvedValue([nota({ archived: true, read: true })]);
    servicio.eliminarNota.mockRejectedValueOnce(
      errorApi(
        409,
        "Solo puede eliminar definitivamente una nota ya archivada.",
        "conflict",
      ),
    );
    confirmar.mockResolvedValue(true);
    pintar("?seccion=notas&vista=archive");
    const boton = await screen.findByRole("button", { name: "Eliminar" });
    fireEvent.click(boton);
    expect(
      await screen.findByText(
        "Solo puede eliminar definitivamente una nota ya archivada.",
      ),
    ).toBeInTheDocument();
    expect(confirmar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "Eliminar nota" }),
    );
    fireEvent.click(boton);
    await waitFor(() =>
      expect(
        screen.queryByText("Revise el informe de asistencia."),
      ).not.toBeInTheDocument(),
    );
  });

  it("en el escritorio la nota recibida no se puede eliminar", async () => {
    pintar("?seccion=notas");
    await screen.findByText("Revise el informe de asistencia.");
    expect(
      screen.queryByRole("button", { name: "Eliminar" }),
    ).not.toBeInTheDocument();
  });

  it("vacío con la invitación a dejar una nota", async () => {
    servicio.notas.mockResolvedValue([]);
    pintar("?seccion=notas");
    expect(
      await screen.findByText(
        "Su escritorio está despejado: no tiene notas pendientes.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dejar una nota" }));
    expect(
      await screen.findByRole("dialog", { name: "Dejar una nota" }),
    ).toBeInTheDocument();
  });
});

async function abrirNota(mensaje = "Revise el informe de asistencia.") {
  pintar("?seccion=notas");
  const tarjeta = (await screen.findByText(mensaje)).closest("li");
  fireEvent.click(within(tarjeta).getByRole("button", { name: /^Abrir/ }));
  return screen.findByRole("dialog", { name: /^Nota de/ });
}

describe("Foco tras las acciones", () => {
  it("archivar lleva el foco a la nota vecina", async () => {
    pintar("?seccion=notas");
    const primera = (
      await screen.findByText("Revise el informe de asistencia.")
    ).closest("li");
    fireEvent.click(within(primera).getByRole("button", { name: "Archivar" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Abrir la nota de Luis Pérez/ }),
      ).toHaveFocus(),
    );
    expect(
      screen.queryByText("Revise el informe de asistencia."),
    ).not.toBeInTheDocument();
  });

  it("si la lista queda vacía, el foco va al contador", async () => {
    servicio.notas.mockResolvedValue([nota()]);
    pintar("?seccion=notas");
    const unica = (
      await screen.findByText("Revise el informe de asistencia.")
    ).closest("li");
    fireEvent.click(within(unica).getByRole("button", { name: "Archivar" }));
    await waitFor(() =>
      expect(document.getElementById("ed-notas-contador")).toHaveFocus(),
    );
  });

  it("marcar leída deja el foco en «Abrir» de esa nota", async () => {
    pintar("?seccion=notas");
    const primera = (
      await screen.findByText("Revise el informe de asistencia.")
    ).closest("li");
    fireEvent.click(
      within(primera).getByRole("button", { name: "Marcar como leída" }),
    );
    await waitFor(() =>
      expect(
        within(primera).getByRole("button", { name: /^Abrir/ }),
      ).toHaveFocus(),
    );
  });

  it("eliminar un recordatorio lleva el foco al título del siguiente", async () => {
    confirmar.mockResolvedValue(true);
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Enviar el reporte");
    fireEvent.click(within(r).getByRole("button", { name: "Eliminar" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Pagar la cuota" }),
      ).toHaveFocus(),
    );
  });

  it("completar deja el foco en el título del recordatorio", async () => {
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Enviar el reporte");
    fireEvent.click(within(r).getByRole("button", { name: /^Completar/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Enviar el reporte" }),
      ).toHaveFocus(),
    );
  });

  it("posponer devuelve el foco a «Posponer»", async () => {
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Enviar el reporte");
    const posponer = within(r).getByRole("button", { name: /^Posponer/ });
    fireEvent.click(posponer);
    fireEvent.click(within(r).getByRole("button", { name: "1 hora" }));
    await waitFor(() => expect(posponer).toHaveFocus());
  });
});

describe("Nota abierta", () => {
  it("abrirla la marca leída; muestra cuántas respuestas quedan", async () => {
    const ventana = await abrirNota();
    await waitFor(() =>
      expect(servicio.accionDeNota).toHaveBeenCalledWith(20, "read"),
    );
    expect(
      await within(ventana).findByText(/Le quedan 2 respuestas en esta nota/),
    ).toBeInTheDocument();
  });

  it("responder suma la respuesta; la segunda deja el tope", async () => {
    servicio.respuestas.mockResolvedValue([
      {
        id: 1,
        message: "Ya lo reviso.",
        author: { id: 1, full_name: "Ana Ruiz" },
        created_at: "2026-11-05T16:00:00Z",
      },
    ]);
    const ventana = await abrirNota();
    expect(
      await within(ventana).findByText(/Le queda 1 respuesta en esta nota/),
    ).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText("Su respuesta"), {
      target: { value: "Listo, enviado." },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Responder/ }));
    await waitFor(() =>
      expect(servicio.responder).toHaveBeenCalledWith(20, "Listo, enviado."),
    );
    expect(
      await within(ventana).findByText(/Esta nota ya tiene sus 2 respuestas/),
    ).toBeInTheDocument();
    expect(
      within(ventana).queryByLabelText("Su respuesta"),
    ).not.toBeInTheDocument();
  });

  it("si la otra persona ocupó la última respuesta (409), lo dice", async () => {
    servicio.responder.mockRejectedValue(
      errorApi(
        409,
        "Esta conversación alcanzó el límite permitido.",
        "conflict",
      ),
    );
    const ventana = await abrirNota();
    fireEvent.change(await within(ventana).findByLabelText("Su respuesta"), {
      target: { value: "Otra más." },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Responder/ }));
    expect(
      await within(ventana).findByText(
        "Esta conversación alcanzó el límite permitido.",
      ),
    ).toBeInTheDocument();
    expect(
      within(ventana).queryByLabelText("Su respuesta"),
    ).not.toBeInTheDocument();
  });

  it("una respuesta vacía no se manda y enfoca el campo", async () => {
    const ventana = await abrirNota();
    const campo = await within(ventana).findByLabelText("Su respuesta");
    fireEvent.click(within(ventana).getByRole("button", { name: /Responder/ }));
    await waitFor(() => expect(campo).toHaveFocus());
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(servicio.responder).not.toHaveBeenCalled();
  });

  it("sin respuestas lo dice; la última usada lleva el foco al aviso del tope", async () => {
    const ventana = await abrirNota();
    expect(
      await within(ventana).findByText("Todavía no hay respuestas."),
    ).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText("Su respuesta"), {
      target: { value: "Primera." },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Responder/ }));
    await waitFor(() => expect(servicio.responder).toHaveBeenCalledTimes(1));
    fireEvent.change(within(ventana).getByLabelText("Su respuesta"), {
      target: { value: "Segunda." },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Responder/ }));
    await waitFor(() =>
      expect(
        within(ventana)
          .getByText(/Esta nota ya tiene sus 2 respuestas/)
          .closest("p"),
      ).toHaveFocus(),
    );
  });

  it("el resultado de convertir se anuncia en una región ya montada y recibe el foco", async () => {
    const ventana = await abrirNota();
    const region = await waitFor(() => {
      const vacia = within(ventana)
        .getAllByRole("status")
        .find((r) => r.id.endsWith("-resultado"));
      expect(vacia).toBeTruthy();
      return vacia;
    });
    expect(region).toHaveTextContent("");
    fireEvent.click(
      within(ventana).getByRole("button", {
        name: /Convertir en recordatorio/,
      }),
    );
    fireEvent.change(within(ventana).getByLabelText(/^Recordarme el/), {
      target: { value: "2099-12-01T09:00" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Crear recordatorio" }),
    );
    // El mismo nodo, ya montado, recibe el texto y el foco.
    await waitFor(() =>
      expect(region).toHaveTextContent(/Se creó el recordatorio/),
    );
    expect(region.isConnected).toBe(true);
    await waitFor(() => expect(region).toHaveFocus());
  });

  it("convierte en recordatorio con la prioridad traducida", async () => {
    const ventana = await abrirNota();
    fireEvent.click(
      within(ventana).getByRole("button", {
        name: /Convertir en recordatorio/,
      }),
    );
    const crear = within(ventana).getByRole("button", {
      name: "Crear recordatorio",
    });
    fireEvent.click(crear);
    const vence = within(ventana).getByLabelText(/^Recordarme el/);
    await waitFor(() => expect(vence).toHaveFocus());
    expect(vence).toHaveAttribute("aria-invalid", "true");
    // La nota es «Importante»: el recordatorio propone «Alta».
    expect(within(ventana).getByLabelText("Prioridad")).toHaveValue("ALTA");
    fireEvent.change(vence, { target: { value: "2099-12-01T09:00" } });
    fireEvent.click(crear);
    await waitFor(() =>
      expect(servicio.convertirEnRecordatorio).toHaveBeenCalledWith(20, {
        due_at: new Date("2099-12-01T09:00").toISOString(),
        title: "Revise el informe de asistencia.",
        priority: "ALTA",
      }),
    );
    expect(
      await within(ventana).findByText(/Se creó el recordatorio/),
    ).toBeInTheDocument();
  });

  it("convertir dos veces (409) se refleja sin crear otro", async () => {
    servicio.convertirEnRecordatorio.mockRejectedValue(
      errorApi(409, "Esta nota ya fue convertida en recordatorio.", "conflict"),
    );
    const ventana = await abrirNota();
    fireEvent.click(
      within(ventana).getByRole("button", {
        name: /Convertir en recordatorio/,
      }),
    );
    fireEvent.change(within(ventana).getByLabelText(/^Recordarme el/), {
      target: { value: "2099-12-01T09:00" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Crear recordatorio" }),
    );
    expect(
      await within(ventana).findByText(
        "Esta nota ya fue convertida en recordatorio.",
      ),
    ).toBeInTheDocument();
    expect(
      within(ventana).queryByRole("button", {
        name: /Convertir en recordatorio/,
      }),
    ).not.toBeInTheDocument();
  });

  it("el adjunto se abre en el visor interno", async () => {
    const ventana = await abrirNota("Gracias por la ayuda.");
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Ver acta\.pdf/ }),
    );
    await waitFor(() =>
      expect(descargar).toHaveBeenCalledWith(
        "/escritorio/notes/21/attachment/",
      ),
    );
    expect(
      await screen.findByRole("dialog", { name: "acta.pdf" }),
    ).toBeInTheDocument();
  });

  it("el historial se pide al abrirlo", async () => {
    const ventana = await abrirNota();
    expect(servicio.historialDeNota).not.toHaveBeenCalled();
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Ver historial/ }),
    );
    expect(await within(ventana).findByText("Creado")).toBeInTheDocument();
  });
});

// --- Nota nueva -------------------------------------------------------------------

async function abrirNuevaNota() {
  pintar();
  fireEvent.click(await screen.findByRole("button", { name: /Nueva nota/ }));
  const ventana = await screen.findByRole("dialog", { name: "Dejar una nota" });
  await within(ventana).findByRole("radio", { name: /Luis Pérez/ });
  return ventana;
}

const BUSCADOR_PARA = "Buscar a quién dejarle la nota";

describe("Nota nueva", () => {
  it("abre con el foco en el buscador de «Para» aunque las personas aún carguen", async () => {
    let soltar;
    servicio.destinatarios.mockReturnValue(
      new Promise((resolver) => {
        soltar = resolver;
      }),
    );
    pintar();
    fireEvent.click(await screen.findByRole("button", { name: /Nueva nota/ }));
    const ventana = await screen.findByRole("dialog", {
      name: "Dejar una nota",
    });
    const buscador = within(ventana).getByLabelText(BUSCADOR_PARA);
    expect(buscador).toHaveFocus();
    expect(buscador).not.toBeDisabled();
    soltar([{ id: 2, full_name: "Luis Pérez" }]);
    expect(
      await within(ventana).findByRole("radio", { name: /Luis Pérez/ }),
    ).toBeInTheDocument();
  });

  it("«Para» se busca en la lista y es de una sola persona", async () => {
    servicio.destinatarios.mockResolvedValue([
      { id: 2, full_name: "Luis Pérez" },
      { id: 3, full_name: "Marta Ríos" },
    ]);
    const ventana = await abrirNuevaNota();
    fireEvent.change(within(ventana).getByLabelText(BUSCADOR_PARA), {
      target: { value: "rios" },
    });
    await waitFor(() =>
      expect(
        within(ventana).queryByRole("radio", { name: /Luis Pérez/ }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(within(ventana).getByRole("radio", { name: /Marta Ríos/ }));
    expect(
      within(ventana).getByRole("button", { name: /Quitar Marta Ríos/ }),
    ).toBeInTheDocument();
    // Se pidió una sola vez: buscar filtra aquí.
    expect(servicio.destinatarios).toHaveBeenCalledTimes(1);
  });

  it("valida destinatario y mensaje y lleva el foco al primero", async () => {
    const ventana = await abrirNuevaNota();
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Dejar nota/ }),
    );
    const para = within(ventana).getByLabelText(BUSCADOR_PARA);
    await waitFor(() => expect(para).toHaveFocus());
    expect(para).toHaveAttribute("aria-invalid", "true");
    expect(within(ventana).getByLabelText(/^Mensaje/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(servicio.crearNota).not.toHaveBeenCalled();
  });

  it("cuenta los caracteres del mensaje (500)", async () => {
    const ventana = await abrirNuevaNota();
    const mensaje = within(ventana).getByLabelText(/^Mensaje/);
    expect(mensaje).toHaveAttribute("maxLength", "500");
    fireEvent.change(mensaje, { target: { value: "Hola" } });
    expect(mensaje).toHaveAccessibleDescription("4 de 500 caracteres.");
  });

  it("rechaza un adjunto de formato no admitido o demasiado grande", async () => {
    const ventana = await abrirNuevaNota();
    const campo = within(ventana).getByLabelText("Archivo adjunto (opcional)");
    fireEvent.change(campo, { target: { files: [archivo("virus.exe", 10)] } });
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAccessibleDescription(/Formato no admitido/);
    fireEvent.change(campo, {
      target: { files: [archivo("grande.pdf", 9 * 1024 * 1024)] },
    });
    expect(campo).toHaveAccessibleDescription(/el máximo es 8 MB/);
  });

  it("deja la nota con su color, prioridad y adjunto", async () => {
    const ventana = await abrirNuevaNota();
    fireEvent.click(within(ventana).getByRole("radio", { name: /Luis Pérez/ }));
    fireEvent.change(within(ventana).getByLabelText(/^Mensaje/), {
      target: { value: "  Pase por mi oficina.  " },
    });
    fireEvent.click(within(ventana).getByRole("radio", { name: /Urgente/ }));
    fireEvent.click(within(ventana).getByRole("radio", { name: "Lila" }));
    const adjunto = archivo("acta.pdf", 1000);
    fireEvent.change(
      within(ventana).getByLabelText("Archivo adjunto (opcional)"),
      { target: { files: [adjunto] } },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Dejar nota/ }),
    );
    await waitFor(() =>
      expect(servicio.crearNota).toHaveBeenCalledWith({
        recipient: 2,
        message: "Pase por mi oficina.",
        priority: "URGENTE",
        color: "LILA",
        archivo: adjunto,
      }),
    );
    expect(
      await screen.findByText(/Nota dejada a Luis Pérez/),
    ).toBeInTheDocument();
  });

  it("el motivo del servidor sobre el adjunto va bajo su campo", async () => {
    servicio.crearNota.mockRejectedValue(
      errorApi(
        400,
        "El contenido no corresponde a un PDF.",
        "validation_error",
        {
          attachment: ["El contenido no corresponde a un PDF."],
        },
      ),
    );
    const ventana = await abrirNuevaNota();
    fireEvent.click(within(ventana).getByRole("radio", { name: /Luis Pérez/ }));
    fireEvent.change(within(ventana).getByLabelText(/^Mensaje/), {
      target: { value: "Adjunto." },
    });
    fireEvent.change(
      within(ventana).getByLabelText("Archivo adjunto (opcional)"),
      { target: { files: [archivo("falso.pdf", 100)] } },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Dejar nota/ }),
    );
    const campo = within(ventana).getByLabelText("Archivo adjunto (opcional)");
    await waitFor(() => expect(campo).toHaveAttribute("aria-invalid", "true"));
    expect(campo).toHaveFocus();
  });
});

// --- Recordatorios ----------------------------------------------------------------

const tarjeta = async (titulo) =>
  (await screen.findByRole("heading", { name: titulo })).closest("li");

describe("Recordatorios", () => {
  it("lista con prioridad, estado, vencido y repetición", async () => {
    pintar("?seccion=recordatorios");
    const vencido = await tarjeta("Pagar la cuota");
    expect(within(vencido).getByText("Vencido")).toBeInTheDocument();
    expect(within(vencido).getByText("Mensual")).toBeInTheDocument();
    const hecho = await tarjeta("Revisar contratos");
    expect(within(hecho).getByText("Completado")).toBeInTheDocument();
    expect(
      within(hecho).getByRole("button", { name: /Reabrir/ }),
    ).toBeInTheDocument();
  });

  it("completar uno que se repite recarga para traer el siguiente", async () => {
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Pagar la cuota");
    fireEvent.click(within(r).getByRole("button", { name: /^Completar/ }));
    await waitFor(() =>
      expect(servicio.accionDeRecordatorio).toHaveBeenCalledWith(
        31,
        "complete",
        null,
      ),
    );
    await waitFor(() =>
      expect(servicio.recordatorios).toHaveBeenCalledTimes(2),
    );
  });

  it("completar dos veces (409) se avisa y recarga", async () => {
    servicio.accionDeRecordatorio.mockRejectedValueOnce(
      errorApi(409, "Este recordatorio ya está completado.", "conflict"),
    );
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Enviar el reporte");
    fireEvent.click(within(r).getByRole("button", { name: /^Completar/ }));
    expect(
      await screen.findByText(/Este recordatorio ya está completado\./),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(servicio.recordatorios).toHaveBeenCalledTimes(2),
    );
  });

  it("posponer con un atajo manda la fecha calculada", async () => {
    const ahora = Date.now();
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Enviar el reporte");
    fireEvent.click(within(r).getByRole("button", { name: /^Posponer/ }));
    // El foco va al campo de fecha, no a un atajo que actúa al instante.
    await waitFor(() =>
      expect(within(r).getByLabelText("Posponer hasta")).toHaveFocus(),
    );
    expect(
      within(r).getByRole("group", { name: /Posponer: atajos/ }),
    ).toBeInTheDocument();
    const atajo = within(r).getByRole("button", { name: "30 minutos" });
    expect(
      within(r).getByRole("button", { name: "Mañana a esta hora" }),
    ).toBeInTheDocument();
    fireEvent.click(atajo);
    await waitFor(() =>
      expect(servicio.accionDeRecordatorio).toHaveBeenCalledWith(
        30,
        "postpone",
        expect.any(String),
      ),
    );
    const iso = servicio.accionDeRecordatorio.mock.calls[0][2];
    const diferencia = new Date(iso).getTime() - ahora;
    expect(diferencia).toBeGreaterThanOrEqual(30 * 60 * 1000 - 1000);
    expect(diferencia).toBeLessThan(31 * 60 * 1000);
  });

  it("posponer a mano sin fecha avisa; Escape cierra y devuelve el foco", async () => {
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Enviar el reporte");
    const posponer = within(r).getByRole("button", { name: /^Posponer/ });
    fireEvent.click(posponer);
    fireEvent.click(within(r).getByRole("button", { name: "Posponer" }));
    const campo = within(r).getByLabelText("Posponer hasta");
    await waitFor(() => expect(campo).toHaveFocus());
    expect(campo).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(campo, { key: "Escape" });
    await waitFor(() => expect(posponer).toHaveFocus());
    expect(posponer).toHaveAttribute("aria-expanded", "false");
  });

  it("reabrir sin fecha manda solo la acción", async () => {
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Revisar contratos");
    fireEvent.click(within(r).getByRole("button", { name: /^Reabrir/ }));
    fireEvent.click(within(r).getByRole("button", { name: "Reabrir" }));
    await waitFor(() =>
      expect(servicio.accionDeRecordatorio).toHaveBeenCalledWith(
        32,
        "reopen",
        null,
      ),
    );
  });

  it("convierte en tarea con las fechas como las guarda Tareas", async () => {
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Enviar el reporte");
    fireEvent.click(
      within(r).getByRole("button", { name: "Convertir en tarea" }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Convertir en tarea",
    });
    fireEvent.change(within(ventana).getByLabelText(/^Inicio/), {
      target: { value: "2026-11-10" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Fin/), {
      target: { value: "2026-11-09" },
    });
    fireEvent.change(within(ventana).getByLabelText(/^Horas estimadas/), {
      target: { value: "0" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Crear tarea/ }),
    );
    const fin = within(ventana).getByLabelText(/^Fin/);
    await waitFor(() => expect(fin).toHaveFocus());
    expect(within(ventana).getByLabelText(/^Horas estimadas/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    fireEvent.change(fin, { target: { value: "2026-11-12" } });
    fireEvent.change(within(ventana).getByLabelText(/^Horas estimadas/), {
      target: { value: "1,5" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Crear tarea/ }),
    );
    await waitFor(() =>
      expect(servicio.convertirEnTarea).toHaveBeenCalledWith(30, {
        title: "Enviar el reporte",
        type: "SEGUIMIENTO",
        frequency: "PUNTUAL",
        start_date: "2026-11-10T00:00:00Z",
        end_date: "2026-11-12T00:00:00Z",
        estimated_hours: 1.5,
      }),
    );
    expect(
      await screen.findByText(/Se creó la tarea «Enviar el reporte»/),
    ).toBeInTheDocument();
    expect(
      within(r).getByRole("link", { name: /ver la tarea/ }),
    ).toHaveAttribute("href", "/admin/gestion-humana/tareas/77");
  });

  it("convertir en tarea por segunda vez (409) lo dice en la ventana", async () => {
    servicio.convertirEnTarea.mockRejectedValue(
      errorApi(
        409,
        "Este recordatorio ya fue convertido en tarea.",
        "conflict",
      ),
    );
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Enviar el reporte");
    fireEvent.click(
      within(r).getByRole("button", { name: "Convertir en tarea" }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Convertir en tarea",
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Crear tarea/ }),
    );
    expect(
      await within(ventana).findByText(
        /Este recordatorio ya fue convertido en tarea\. No se creó otra/,
      ),
    ).toBeInTheDocument();
  });

  it("sin acceso a Tareas no se ofrece convertir en tarea", async () => {
    usar(ME_SIN_TAREAS);
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Enviar el reporte");
    expect(
      within(r).queryByRole("button", { name: "Convertir en tarea" }),
    ).not.toBeInTheDocument();
  });

  it("archivar lo saca de la lista", async () => {
    pintar("?seccion=recordatorios");
    const r = await tarjeta("Enviar el reporte");
    fireEvent.click(within(r).getByRole("button", { name: "Archivar" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Enviar el reporte" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("el filtro de archivados se pide al servidor", async () => {
    pintar("?seccion=recordatorios");
    await tarjeta("Enviar el reporte");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Ver los archivados" }),
    );
    await waitFor(() =>
      expect(servicio.recordatorios).toHaveBeenLastCalledWith({
        archived: true,
        status: "",
      }),
    );
  });

  it("nuevo recordatorio: título obligatorio y luego se crea", async () => {
    pintar("?seccion=recordatorios");
    await tarjeta("Enviar el reporte");
    fireEvent.click(screen.getByRole("button", { name: /Nuevo recordatorio/ }));
    const ventana = await screen.findByRole("dialog", {
      name: "Nuevo recordatorio",
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Crear recordatorio/ }),
    );
    const titulo = within(ventana).getByLabelText(/^Título/);
    await waitFor(() => expect(titulo).toHaveFocus());
    fireEvent.change(titulo, { target: { value: "Llamar a proveedores" } });
    fireEvent.change(within(ventana).getByLabelText("Repetición"), {
      target: { value: "SEMANAL" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Crear recordatorio/ }),
    );
    await waitFor(() =>
      expect(servicio.crearRecordatorio).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Llamar a proveedores",
          repeat: "SEMANAL",
          priority: "MEDIA",
        }),
      ),
    );
    expect(
      await screen.findByText("Recordatorio «Llamar a proveedores» creado."),
    ).toBeInTheDocument();
  });
});

// --- Buscar -----------------------------------------------------------------------

describe("Contador de notas sin leer", () => {
  it("la pestaña se pone al día cuando el menú avisa de un cambio", async () => {
    pintar("?seccion=notas");
    await screen.findByRole("tab", { name: /Notas\s*1 sin leer/ });
    servicio.sinLeer.mockResolvedValue({ unread: 3 });
    window.dispatchEvent(new CustomEvent("mz-insignias-cambiaron"));
    expect(
      await screen.findByRole("tab", { name: /Notas\s*3 sin leer/ }),
    ).toBeInTheDocument();
  });
});

describe("Buscar", () => {
  it("busca mientras se escribe (sin botón), deja los filtros en la URL y muestra notas y recordatorios", async () => {
    pintar("?seccion=buscar");
    expect(
      await screen.findByText(/Escriba un texto o elija un filtro/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Texto"), {
      target: { value: "informe" },
    });
    fireEvent.change(screen.getByLabelText("Estado"), {
      target: { value: "PENDIENTE" },
    });
    // Búsqueda en vivo (06/11/2026): ya no hay botón «Buscar».
    expect(
      screen.queryByRole("button", { name: /^Buscar$/ }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(servicio.buscar).toHaveBeenCalledWith(
        expect.objectContaining({ q: "informe", status: "PENDIENTE" }),
      ),
    );
    expect(screen.getByTestId("ubicacion")).toHaveTextContent("q=informe");
    expect(
      await screen.findByText("1 nota y 1 recordatorio."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Recordatorios" }),
    ).toHaveTextContent("Enviar el reporte");
    expect(
      screen.getByRole("button", { name: "Abrir la nota de Luis Pérez" }),
    ).toBeInTheDocument();
  });
});

// --- Utilidades, contraste y estilos ------------------------------------------------

describe("Utilidades", () => {
  it("los atajos de posponer se leen en palabras", () => {
    expect(textoDePosponer(15)).toBe("15 minutos");
    expect(textoDePosponer(60)).toBe("1 hora");
    expect(textoDePosponer(120)).toBe("2 horas");
    expect(textoDePosponer(1440)).toBe("Mañana a esta hora");
  });

  it("los datos de prueba tienen la forma del servidor", () => {
    expect(NOTAS[0]).toHaveProperty("can_reply");
    expect(RECORDATORIOS[0]).toHaveProperty("converted_to_task_id");
    expect(recordatorio().repeat).toBe("UNA_VEZ");
  });
});

const leer = (relativa) =>
  readFileSync(path.resolve(__dirname, "..", relativa), "utf8");

function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Los colores de las notas declarados en un bloque del CSS. */
function coloresDe(hoja, selector) {
  const inicio = hoja.indexOf(`${selector} {`);
  const bloque = hoja.slice(inicio, hoja.indexOf("}", inicio));
  return [...bloque.matchAll(/--ed-nota-(\w+): (#[0-9a-f]{6});/gi)].map(
    ([, nombre, hex]) => ({ nombre, hex }),
  );
}

describe("Auditoría: contraste de los colores de las notas", () => {
  const hoja = leer("src/pages/GestionHumana/Escritorio/Escritorio.css");
  // Los textos de la identidad (`marca.css`): el más tenue y el principal.
  const TEMAS = {
    claro: { selector: ":root", textos: ["#666666", "#474747"] },
    oscuro: {
      selector: ':root[data-theme="dark"]',
      textos: ["#9a9a9a", "#c4c4c4", "#f2f2f2"],
    },
  };

  for (const [tema, { selector, textos }] of Object.entries(TEMAS)) {
    it(`tema ${tema}: los seis colores dejan el texto por encima de 4,5:1`, () => {
      const colores = coloresDe(hoja, selector);
      expect(colores.map((c) => c.nombre).sort()).toEqual([
        "amarillo",
        "celeste",
        "lila",
        "naranja",
        "rosado",
        "verde",
      ]);
      for (const { hex } of colores)
        for (const texto of textos)
          expect(contraste(hex, texto)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("los textos tomados son los de la identidad", () => {
    const marca = leer("src/styles/marca.css");
    expect(marca).toContain("--mz-ink-faint: #666666");
    expect(marca).toContain("--mz-ink-faint: #9a9a9a");
  });

  it("los botones de la nota van en una banda neutra, no sobre el color", () => {
    const bloque = hoja.slice(hoja.indexOf(".ed-nota__acciones {"));
    expect(bloque.slice(0, bloque.indexOf("}"))).toContain(
      "background: var(--mz-raised)",
    );
  });

  it("una columna en ≤ 880 px y objetivos de 44 px al tacto", () => {
    expect(hoja).toContain("@media (max-width: 880px)");
    expect(hoja).toMatch(/@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
  });
});
