import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Ausencias visibles y reemplazo en las aprobaciones (11/11/2026, US-001):
 * «Fuera de la oficina» en «Mi estado», la pregunta «¿Quién aprueba por
 * usted mientras no está?», la etiqueta junto al aprobador y el aviso del
 * chat con el reemplazo.
 */

const chat = {
  presencia: vi.fn(),
  miEstado: vi.fn(),
  guardarEstado: vi.fn(),
  directorio: vi.fn(),
};
vi.mock("../src/api/chatService", () => ({ chatService: chat }));
const reemplazo = { obtener: vi.fn(), guardar: vi.fn() };
vi.mock("../src/api/reemplazoService", () => ({ reemplazoService: reemplazo }));

const { MiEstado, errorDeRegreso } =
  await import("../src/components/admin/Chat/MiEstado");
const { AvisoDeEstado, Presencia } =
  await import("../src/components/admin/Chat/Presencia");
const { EtiquetaAusencia, AprobadoresPendientes } =
  await import("../src/components/common/Ausencia/EtiquetaAusencia");

const DISPONIBLE = {
  estado: "disponible",
  mensaje: "",
  hasta: null,
  vacaciones_desde: null,
  vacaciones_hasta: null,
  mensaje_vacaciones: "",
  almuerzo_inicio: "",
  almuerzo_minutos: 60,
  vigente: null,
  vacaciones_sugeridas: null,
};

const CON_JEFE = {
  modo: "jefe",
  persona: null,
  jefe: { id: 4, nombre: "Julia Paz" },
};

/** AAAA-MM-DD de dentro de `dias` días, en hora local. */
function enDias(dias) {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  const dos = (n) => String(n).padStart(2, "0");
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
}

function errorDe(campo) {
  const id = campo.getAttribute("aria-describedby") ?? "";
  return id
    .split(" ")
    .map((parte) => document.getElementById(parte)?.textContent ?? "")
    .join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  chat.miEstado.mockResolvedValue(DISPONIBLE);
  chat.directorio.mockResolvedValue([
    { id: 9, nombre: "Tatiana Torres", cargo: "Analista" },
  ]);
  reemplazo.obtener.mockResolvedValue(CON_JEFE);
});

async function abrirFueraDeLaOficina() {
  render(<MiEstado />);
  fireEvent.click(await screen.findByRole("button", { name: /Disponible/ }));
  fireEvent.click(screen.getByLabelText(/Fuera de la oficina/));
  return screen.getByLabelText(/^Último día fuera de la oficina/);
}

describe("«Fuera de la oficina» en Mi estado", () => {
  it("la fecha de regreso es obligatoria y no puede haber pasado", async () => {
    const regreso = await abrirFueraDeLaOficina();
    expect(regreso).toHaveAttribute("type", "date");
    expect(regreso).toHaveAttribute("aria-required", "true");

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(regreso).toHaveAttribute("aria-invalid", "true");
    expect(regreso).toHaveClass("is-invalid");
    expect(errorDe(regreso)).toContain(
      "Indique hasta cuándo estará fuera de la oficina.",
    );

    fireEvent.change(regreso, { target: { value: "2000-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(errorDe(regreso)).toContain(
      "Elija como último día hoy o una fecha posterior.",
    );
    expect(chat.guardarEstado).not.toHaveBeenCalled();
    expect(errorDeRegreso(enDias(0))).toBeNull();
  });

  it("guarda la fecha sola y el mensaje, y antes el reemplazo elegido", async () => {
    const orden = [];
    reemplazo.guardar.mockImplementation(async () => {
      orden.push("reemplazo");
      return { modo: "persona", persona: { id: 9, nombre: "Tatiana Torres" } };
    });
    chat.guardarEstado.mockImplementation(async () => {
      orden.push("estado");
      return {
        ...DISPONIBLE,
        estado: "fuera_oficina",
        vigente: {
          clave: "fuera_oficina",
          detalle: "Fuera de la oficina hasta el 20/11",
        },
      };
    });
    const regreso = await abrirFueraDeLaOficina();
    const fecha = enDias(3);
    fireEvent.change(regreso, { target: { value: fecha } });
    fireEvent.change(screen.getByLabelText(/Mensaje para quien le escriba/), {
      target: { value: "En la agencia de Loja" },
    });
    fireEvent.click(await screen.findByLabelText("Otra persona"));
    fireEvent.click(await screen.findByLabelText(/Tatiana Torres/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(chat.guardarEstado).toHaveBeenCalledWith(
        expect.objectContaining({
          estado: "fuera_oficina",
          hasta: fecha,
          mensaje: "En la agencia de Loja",
        }),
      ),
    );
    expect(reemplazo.guardar).toHaveBeenCalledWith({
      modo: "persona",
      persona_id: 9,
    });
    expect(orden).toEqual(["reemplazo", "estado"]);
    expect(
      await screen.findByRole("button", { name: /Fuera de la oficina/ }),
    ).toBeInTheDocument();
  });

  it("el error del servidor en la fecha va junto al campo", async () => {
    chat.guardarEstado.mockRejectedValue({
      response: {
        data: {
          error: {
            code: "validation_error",
            message: "Error en la solicitud.",
            details: {
              hasta: ["Elija una fecha de regreso que todavía no pasó."],
            },
          },
        },
      },
    });
    const regreso = await abrirFueraDeLaOficina();
    fireEvent.change(regreso, { target: { value: enDias(1) } });
    // Se espera a que cargue la pregunta del reemplazo.
    await screen.findByLabelText("Mi jefe inmediato (Julia Paz)");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(regreso).toHaveAttribute("aria-invalid", "true"),
    );
    expect(errorDe(regreso)).toContain(
      "Elija una fecha de regreso que todavía no pasó.",
    );
    // Con su jefe, que ya era lo guardado, no se vuelve a guardar.
    expect(reemplazo.guardar).not.toHaveBeenCalled();
  });
});

describe("¿Quién aprueba por usted?", () => {
  async function abrirVacaciones() {
    render(<MiEstado />);
    fireEvent.click(await screen.findByRole("button", { name: /Disponible/ }));
    fireEvent.click(screen.getByLabelText(/Vacaciones/));
  }

  it("por defecto, su jefe inmediato con su nombre", async () => {
    await abrirVacaciones();
    const grupo = await screen.findByRole("group", {
      name: "¿Quién aprueba por usted?",
    });
    expect(grupo).toBeInTheDocument();
    expect(
      screen.getByLabelText("Mi jefe inmediato (Julia Paz)"),
    ).toBeChecked();
    expect(screen.getByLabelText("Otra persona")).not.toBeChecked();
    // Sin elegir otra persona no aparece el buscador.
    expect(screen.queryByLabelText("Buscar por nombre")).toBeNull();
  });

  it("si no tiene jefe, lo dice", async () => {
    reemplazo.obtener.mockResolvedValue({
      modo: "jefe",
      persona: null,
      jefe: null,
    });
    await abrirVacaciones();
    expect(await screen.findByLabelText("Mi jefe inmediato")).toBeChecked();
    expect(
      screen.getByText(/no tiene un jefe inmediato registrado/),
    ).toBeInTheDocument();
  });

  it("con «Otra persona», hay que elegirla: el error va en el buscador", async () => {
    await abrirVacaciones();
    fireEvent.change(screen.getByLabelText(/^Desde/), {
      target: { value: enDias(1) },
    });
    fireEvent.change(screen.getByLabelText(/^Hasta/), {
      target: { value: enDias(5) },
    });
    fireEvent.click(await screen.findByLabelText("Otra persona"));
    const buscador = screen.getByLabelText("Buscar por nombre");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(buscador).toHaveAttribute("aria-invalid", "true"),
    );
    expect(errorDe(buscador)).toContain(
      "Elija a la persona que aprobará por usted.",
    );
    expect(reemplazo.guardar).not.toHaveBeenCalled();
    expect(chat.guardarEstado).not.toHaveBeenCalled();
  });

  it("el error del servidor sobre la persona va junto al campo y no guarda el estado", async () => {
    reemplazo.guardar.mockRejectedValue({
      response: {
        data: {
          error: {
            code: "validation_error",
            message: "Error en la solicitud.",
            details: {
              persona_id: [
                "Esa persona no tiene una cuenta activa en esta empresa.",
              ],
            },
          },
        },
      },
    });
    await abrirVacaciones();
    fireEvent.change(screen.getByLabelText(/^Desde/), {
      target: { value: enDias(1) },
    });
    fireEvent.change(screen.getByLabelText(/^Hasta/), {
      target: { value: enDias(5) },
    });
    fireEvent.click(await screen.findByLabelText("Otra persona"));
    fireEvent.click(await screen.findByLabelText(/Tatiana Torres/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    const buscador = screen.getByLabelText("Buscar por nombre");
    await waitFor(() =>
      expect(errorDe(buscador)).toContain(
        "Esa persona no tiene una cuenta activa en esta empresa.",
      ),
    );
    expect(buscador).toHaveAttribute("aria-invalid", "true");
    expect(chat.guardarEstado).not.toHaveBeenCalled();
  });
});

describe("La etiqueta de ausencia", () => {
  const AUSENCIA = {
    clave: "vacaciones",
    texto: "De vacaciones hasta el 20/11",
    hasta: "2026-11-20",
    reemplazo: { id: 9, nombre: "Tatiana Torres" },
  };

  it("dice la ausencia y el reemplazo con ícono y texto", () => {
    const { container } = render(<EtiquetaAusencia ausencia={AUSENCIA} />);
    expect(container).toHaveTextContent(
      "(ausente: De vacaciones hasta el 20/11 · Aprueba en su lugar: Tatiana Torres)",
    );
    expect(container.querySelector(".bi-airplane")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("sin reemplazo no dice «Aprueba en su lugar», y sin ausencia no pinta nada", () => {
    const { container } = render(
      <AprobadoresPendientes
        personas={[
          { id: 4, nombre: "Julia Paz", ausencia: null },
          {
            id: 5,
            nombre: "Luis Mora",
            ausencia: {
              clave: "fuera_oficina",
              texto: "Fuera de la oficina hasta el 18/11",
              hasta: "2026-11-18",
              reemplazo: null,
            },
          },
        ]}
      />,
    );
    expect(container).toHaveTextContent(
      "Julia Paz, Luis Mora (ausente: Fuera de la oficina hasta el 18/11)",
    );
    expect(container).not.toHaveTextContent("Aprueba en su lugar");
    expect(container.querySelectorAll(".etiqueta-ausencia")).toHaveLength(1);
  });
});

describe("El chat con alguien ausente", () => {
  it("el aviso dice hasta cuándo, el mensaje y quién aprueba", () => {
    render(
      <AvisoDeEstado
        nombre="Luis Mora"
        estado={{
          clave: "fuera_oficina",
          texto: "Fuera de la oficina",
          detalle: "Fuera de la oficina hasta el 18/11",
          mensaje: "En la agencia de Loja",
          reemplazo: { id: 9, nombre: "Tatiana Torres" },
        }}
      />,
    );
    const aviso = screen.getByRole("status");
    expect(aviso).toHaveTextContent(
      "Luis Mora está fuera de la oficina hasta el 18/11: verá su mensaje al volver.",
    );
    expect(aviso).toHaveTextContent("«En la agencia de Loja»");
    expect(aviso).toHaveTextContent("Aprueba en su lugar: Tatiana Torres.");
  });

  it("sin reemplazo no dice quién atiende sus aprobaciones", () => {
    render(
      <AvisoDeEstado
        nombre="Beto"
        estado={{
          clave: "vacaciones",
          detalle: "De vacaciones hasta el 20/11",
          mensaje: "",
          reemplazo: null,
        }}
      />,
    );
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "Aprueba en su lugar",
    );
  });

  it("junto al nombre, ícono y texto de «Fuera de la oficina»", () => {
    const { container } = render(
      <Presencia
        estado={{
          en_linea: false,
          estado: {
            clave: "fuera_oficina",
            detalle: "Fuera de la oficina hasta el 18/11",
            mensaje: "",
            reemplazo: { id: 9, nombre: "Tatiana Torres" },
          },
        }}
        conTexto
      />,
    );
    const presencia = container.querySelector(".presencia");
    expect(presencia).toHaveClass("presencia--fuera_oficina");
    expect(presencia).toHaveTextContent("Fuera de la oficina hasta el 18/11");
    expect(presencia.querySelector(".bi-box-arrow-right")).not.toBeNull();
    expect(presencia).toHaveAttribute(
      "title",
      "Fuera de la oficina hasta el 18/11 · Aprueba en su lugar: Tatiana Torres",
    );
    // Lo mismo, oculto, para teclado y lector de pantalla.
    expect(presencia.querySelector(".visually-hidden")).toHaveTextContent(
      "· Aprueba en su lugar: Tatiana Torres",
    );
  });
});

describe("Revisión de la ronda 1 (11/11/2026)", () => {
  const RED = { message: "Network Error" };
  const PERMISO = {
    clave: "fuera_oficina",
    detalle: "Fuera de la oficina hasta el 20/11",
    mensaje: "",
    hasta: "2026-11-20",
  };

  it("el último día no puede pasar de 6 meses", async () => {
    const regreso = await abrirFueraDeLaOficina();
    expect(regreso).toHaveAttribute("max", enDias(180));
    expect(regreso).toHaveAccessibleDescription(
      /Desde el día siguiente vuelve a «Disponible»/,
    );
    fireEvent.change(regreso, { target: { value: enDias(200) } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(errorDe(regreso)).toContain(
      "Elija una fecha dentro de los próximos 6 meses.",
    );
    expect(chat.guardarEstado).not.toHaveBeenCalled();
  });

  it("orden: fecha, mensaje y, aparte, «Mientras usted no está»", async () => {
    const regreso = await abrirFueraDeLaOficina();
    const mensaje = screen.getByLabelText(/Mensaje para quien le escriba/);
    const bloque = await screen.findByRole("region", {
      name: "Mientras usted no está",
    });
    expect(bloque).toHaveTextContent(
      "Esta elección se guarda para todas sus ausencias.",
    );
    const sigue = (a, b) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(sigue(regreso, mensaje)).toBe(true);
    expect(sigue(mensaje, bloque)).toBe(true);
  });

  it("si falla el estado tras guardar el reemplazo, dice que este sí quedó", async () => {
    reemplazo.guardar.mockResolvedValue({
      modo: "persona",
      persona: { id: 9, nombre: "Tatiana Torres" },
      jefe: CON_JEFE.jefe,
    });
    chat.guardarEstado.mockRejectedValue(RED);
    const regreso = await abrirFueraDeLaOficina();
    fireEvent.change(regreso, { target: { value: enDias(2) } });
    fireEvent.click(await screen.findByLabelText("Otra persona"));
    fireEvent.click(await screen.findByLabelText(/Tatiana Torres/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    const alerta = await screen.findByText(/No se pudo guardar su estado\./);
    expect(alerta).toHaveTextContent(
      "Su elección de quién aprueba por usted sí quedó guardada.",
    );
  });

  it("un fallo de red al guardar el reemplazo va al aviso general, no al buscador", async () => {
    reemplazo.guardar.mockRejectedValue(RED);
    const regreso = await abrirFueraDeLaOficina();
    fireEvent.change(regreso, { target: { value: enDias(2) } });
    fireEvent.click(await screen.findByLabelText("Otra persona"));
    fireEvent.click(await screen.findByLabelText(/Tatiana Torres/));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(
      await screen.findByText("No se pudo guardar quién aprueba por usted."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Buscar por nombre")).not.toHaveAttribute(
      "aria-invalid",
    );
    expect(chat.guardarEstado).not.toHaveBeenCalled();
  });

  it("con un permiso aprobado abre en «Fuera de la oficina» y lo explica", async () => {
    chat.miEstado.mockResolvedValue({
      ...DISPONIBLE,
      vigente: {
        clave: "fuera_oficina",
        detalle: "Fuera de la oficina hasta el 20/11",
        mensaje: "",
        hasta: "2026-11-20",
      },
    });
    render(<MiEstado />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Fuera de la oficina/ }),
    );
    expect(screen.getByLabelText(/Fuera de la oficina/)).toBeChecked();
    expect(
      screen.getByText(/Tiene un permiso aprobado hasta el 20\/11/),
    ).toHaveTextContent(
      "mientras dure, quien le escriba verá «Fuera de la oficina».",
    );
  });

  it("con un permiso aprobado, guardar sin cambiar de opción no pide fecha ni manda el estado", async () => {
    chat.miEstado.mockResolvedValue({ ...DISPONIBLE, vigente: PERMISO });
    chat.guardarEstado.mockResolvedValue({ ...DISPONIBLE, vigente: PERMISO });
    render(<MiEstado />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Fuera de la oficina/ }),
    );
    expect(screen.getByText(/por su/).closest("p")).toHaveTextContent(
      "Hasta el 20/11, por su permiso aprobado.",
    );
    expect(
      screen.queryByLabelText(/^Último día fuera de la oficina/),
    ).toBeNull();
    await screen.findByLabelText("Mi jefe inmediato (Julia Paz)");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(chat.guardarEstado).toHaveBeenCalled());
    const enviado = chat.guardarEstado.mock.calls[0][0];
    expect(enviado).not.toHaveProperty("estado");
    expect(enviado).not.toHaveProperty("hasta");
  });

  it("con un permiso aprobado, volver a elegir «Fuera de la oficina» pide la fecha", async () => {
    chat.miEstado.mockResolvedValue({ ...DISPONIBLE, vigente: PERMISO });
    render(<MiEstado />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Fuera de la oficina/ }),
    );
    fireEvent.click(screen.getByLabelText(/^Fuera de la oficina/));
    const regreso = screen.getByLabelText(/^Último día fuera de la oficina/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(regreso).toHaveAttribute("aria-invalid", "true");
    expect(chat.guardarEstado).not.toHaveBeenCalled();
  });

  it("el alcance de la elección forma parte de la descripción de la pregunta", async () => {
    await abrirFueraDeLaOficina();
    const grupo = await screen.findByRole("group", {
      name: "¿Quién aprueba por usted?",
    });
    expect(grupo).toHaveAccessibleDescription(
      /Esta elección se guarda para todas sus ausencias\./,
    );
  });

  it("el botón de su estado dice también hasta cuándo, no solo en el title", async () => {
    chat.miEstado.mockResolvedValue({ ...DISPONIBLE, vigente: PERMISO });
    render(<MiEstado />);
    expect(
      await screen.findByRole("button", {
        name: /hasta el 20\/11/,
      }),
    ).toBeInTheDocument();
  });

  it("las vacaciones piden «Desde» y «Hasta», marcados como obligatorios", async () => {
    render(<MiEstado />);
    fireEvent.click(await screen.findByRole("button", { name: /Disponible/ }));
    fireEvent.click(screen.getByLabelText(/Vacaciones/));
    const desde = screen.getByLabelText(/^Desde/);
    expect(desde).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("Obligatorio")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(desde).toHaveAttribute("aria-invalid", "true");
    expect(errorDe(desde)).toContain(
      "Indique desde cuándo estará de vacaciones.",
    );
    expect(chat.guardarEstado).not.toHaveBeenCalled();
  });
});
