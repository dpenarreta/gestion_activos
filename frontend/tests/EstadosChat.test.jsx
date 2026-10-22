import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Los estados en el chat (22/10/2026): almuerzo, vacaciones, en reunión y no
 * disponible. Lo que ven los demás, el aviso de la conversación y la ventana
 * para elegirlo (con las vacaciones propuestas desde la solicitud).
 */

const servicio = {
  presencia: vi.fn(),
  miEstado: vi.fn(),
  guardarEstado: vi.fn(),
};
vi.mock("../src/api/chatService", () => ({ chatService: servicio }));

const { AvisoDeEstado, Presencia, textoPresencia } =
  await import("../src/components/admin/Chat/Presencia");
const { MiEstado, enHoraDeAlmuerzo } =
  await import("../src/components/admin/Chat/MiEstado");

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

beforeEach(() => {
  vi.clearAllMocks();
  servicio.miEstado.mockResolvedValue(DISPONIBLE);
});

describe("Lo que ven los demás", () => {
  it("el estado elegido va antes que «en línea», con su color", () => {
    const almuerzo = {
      en_linea: true,
      estado: {
        clave: "almuerzo",
        detalle: "En almuerzo hasta las 13:30",
        mensaje: "",
      },
    };
    expect(textoPresencia(almuerzo)).toBe("En almuerzo hasta las 13:30");
    render(<Presencia estado={almuerzo} conTexto />);
    expect(
      screen.getByText("En almuerzo hasta las 13:30").closest(".presencia"),
    ).toHaveClass("presencia--almuerzo");
    // Las próximas vacaciones no tapan «en línea».
    expect(
      textoPresencia({
        en_linea: true,
        estado: { clave: "vacaciones_proximas", detalle: "Estará…" },
      }),
    ).toBe("En línea");
  });

  it("la conversación avisa y deja el mensaje de la persona", () => {
    render(
      <AvisoDeEstado
        nombre="Beto"
        estado={{
          clave: "vacaciones",
          detalle: "De vacaciones hasta el 10/11/2026",
          mensaje: "Para lo urgente, Carla.",
        }}
      />,
    );
    const aviso = screen.getByRole("status");
    expect(aviso).toHaveTextContent(
      "Beto está de vacaciones hasta el 10/11/2026: verá su mensaje al volver.",
    );
    expect(aviso).toHaveTextContent("«Para lo urgente, Carla.»");
  });
});

describe("Mi estado", () => {
  it("propone las vacaciones de su solicitud y las guarda", async () => {
    servicio.miEstado.mockResolvedValue({
      ...DISPONIBLE,
      vacaciones_sugeridas: {
        desde: "2026-11-03",
        hasta: "2026-11-10",
        aprobada: true,
      },
    });
    servicio.guardarEstado.mockResolvedValue({
      ...DISPONIBLE,
      vigente: {
        clave: "vacaciones_proximas",
        detalle: "Estará de vacaciones del 03/11/2026 al 10/11/2026",
      },
    });
    render(<MiEstado />);
    fireEvent.click(await screen.findByRole("button", { name: /Disponible/ }));
    fireEvent.click(screen.getByLabelText(/Vacaciones/));
    expect(screen.getByRole("status")).toHaveTextContent(
      "aprobada: del 03/11/2026 al 10/11/2026",
    );
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-11-03");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-11-10");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(servicio.guardarEstado).toHaveBeenCalledWith(
        expect.objectContaining({
          estado: "vacaciones",
          vacaciones_desde: "2026-11-03",
          vacaciones_hasta: "2026-11-10",
        }),
      ),
    );
  });

  it("guarda el horario y marca que sale a almorzar", async () => {
    servicio.guardarEstado.mockResolvedValue({
      ...DISPONIBLE,
      estado: "almuerzo",
      vigente: { clave: "almuerzo", detalle: "En almuerzo hasta las 13:15" },
    });
    render(<MiEstado />);
    fireEvent.click(await screen.findByRole("button", { name: /Disponible/ }));
    fireEvent.click(screen.getByLabelText(/Almuerzo/));
    fireEvent.change(screen.getByLabelText("Salgo a las"), {
      target: { value: "12:30" },
    });
    fireEvent.change(screen.getByLabelText("Minutos"), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salgo a almorzar" }));
    await waitFor(() =>
      expect(servicio.guardarEstado).toHaveBeenCalledWith(
        expect.objectContaining({
          estado: "almuerzo",
          almuerzo_inicio: "12:30",
          almuerzo_minutos: 45,
        }),
      ),
    );
    expect(
      await screen.findByRole("button", { name: /Almuerzo/ }),
    ).toBeInTheDocument();
  });

  it("sabe cuándo es su hora de almuerzo", () => {
    const a = (h, m) => new Date(2026, 9, 22, h, m);
    expect(enHoraDeAlmuerzo("12:30", 60, a(12, 45))).toBe(true);
    expect(enHoraDeAlmuerzo("12:30", 60, a(13, 30))).toBe(false);
    expect(enHoraDeAlmuerzo("", 60, a(12, 45))).toBe(false);
  });
});
