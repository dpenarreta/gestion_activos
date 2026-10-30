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
 * Institucional → Mis vacaciones: los días disponibles para pedir (contando
 * lo que está en aprobación) y, por cada período, cuántos corresponden,
 * cuántos se gozaron, los fines de semana de la regla y las solicitudes en
 * curso. Con `vacaciones.ver_todas` se consultan los de otra persona.
 */

const permisos = { lista: [] };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { permissions: permisos.lista } }),
}));

const servicio = {
  misVacaciones: vi.fn(),
  personasVacaciones: vi.fn(),
  vacacionesDe: vi.fn(),
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));

const { MisVacacionesPage } =
  await import("../src/pages/Institucional/MisVacacionesPage");

function pintar() {
  return render(
    <MemoryRouter>
      <MisVacacionesPage />
    </MemoryRouter>,
  );
}

function periodo(id, anio, correspondientes, goces, extra = {}) {
  const gozados = goces.reduce((s, g) => s + g.dias, 0);
  const pendientes = correspondientes - gozados;
  return {
    id,
    nombre: `${anio} – ${anio + 1}`,
    desde: `${anio}-03-01`,
    hasta: `${anio + 1}-02-28`,
    correspondientes,
    gozados,
    pendientes,
    reservados: 0,
    disponibles: pendientes,
    sabados: 0,
    domingos: 0,
    nota: "",
    goces,
    ...extra,
  };
}

const MIAS = {
  persona: { id: 1, nombre: "Ana" },
  correspondientes: 46,
  gozados: 21,
  pendientes: 25,
  reservados: 5,
  disponibles: 18,
  periodos_con_pendientes: 2,
  regla: { sabados: 2, domingos: 2 },
  en_curso: [
    {
      id: 40,
      tipo: "Vacaciones",
      desde: "2026-12-07",
      hasta: "2026-12-11",
      dias: 5,
      paso: "Jefatura",
    },
  ],
  periodos: [
    periodo(1, 2023, 15, [
      {
        id: 1,
        desde: "2024-07-01",
        hasta: "2024-07-15",
        dias: 15,
        descripcion: "Vacaciones de verano",
      },
    ]),
    periodo(
      2,
      2024,
      15,
      [
        {
          id: 2,
          desde: "2025-04-14",
          hasta: "2025-04-18",
          dias: 5,
          descripcion: "",
        },
        {
          id: 3,
          desde: "2025-12-27",
          hasta: "2025-12-27",
          dias: 1,
          descripcion: "Marcado por defecto: sábado (regla de fines de semana)",
          por_defecto: true,
        },
      ],
      { reservados: 5, disponibles: 4, sabados: 2, domingos: 1 },
    ),
    periodo(3, 2025, 16, []),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  permisos.lista = ["licencias.solicitar"];
  servicio.misVacaciones.mockResolvedValue(MIAS);
});

describe("Mis vacaciones", () => {
  it("lo disponible para pedir cuenta lo que está en aprobación", async () => {
    pintar();
    expect(
      await screen.findByText("Disponibles para pedir"),
    ).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(
      screen.getByText(/5 días en aprobación · en 2 períodos/),
    ).toBeInTheDocument();
    // Las solicitudes en curso, con su enlace.
    expect(
      screen.getByRole("link", { name: /07\/12\/2026 al 11\/12\/2026/ }),
    ).toHaveAttribute("href", "/admin/institucional/permisos?solicitud=40");
    expect(
      screen.queryByText(/Consultar las vacaciones de otra persona/),
    ).toBeNull();
  });

  it("«Solicitar vacaciones» lleva a la solicitud con el tipo elegido", async () => {
    pintar();
    expect(
      await screen.findByRole("link", { name: /Solicitar vacaciones/ }),
    ).toHaveAttribute("href", "/admin/institucional/permisos?nueva=vacaciones");
  });

  it("por período: cifras, fines de semana y lo marcado por defecto", async () => {
    pintar();
    const p2024 = await screen.findByRole("region", {
      name: "Período 2024 – 2025",
    });
    expect(within(p2024).getByText("4 días disponibles")).toBeInTheDocument();
    expect(within(p2024).getByText("En aprobación")).toBeInTheDocument();
    expect(p2024).toHaveTextContent(
      /Fines de semana: 2 de 2 sábados · 1 de 2 domingos/,
    );
    expect(within(p2024).getByText("Faltan")).toBeInTheDocument();
    expect(within(p2024).getByText("Por defecto")).toBeInTheDocument();
    expect(
      within(p2024).getByRole("table", {
        name: "Días gozados del período 2024 – 2025",
      }),
    ).toBeInTheDocument();

    // El gozado por completo va aparte, para cuadrar los totales.
    expect(
      screen.queryByRole("region", { name: "Período 2023 – 2024" }),
    ).toBeNull();
    expect(
      screen.getByText(/Ver 1 período ya gozado por completo/),
    ).toBeInTheDocument();

    const p2025 = screen.getByRole("region", { name: "Período 2025 – 2026" });
    expect(
      within(p2025).getByText("Todavía no ha gozado días de este período."),
    ).toBeInTheDocument();
  });

  it("del más antiguo al más nuevo, el primero se descuenta primero", async () => {
    pintar();
    await screen.findByText("Disponibles para pedir");
    const titulos = screen
      .getAllByRole("heading", { level: 3, name: /^Período/ })
      .map((h) => h.textContent);
    expect(titulos).toEqual(["Período 2024 – 2025", "Período 2025 – 2026"]);
    const primero = screen.getByRole("region", {
      name: "Período 2024 – 2025",
    });
    expect(
      within(primero).getByText("Se descuenta primero"),
    ).toBeInTheDocument();
  });

  it("si todo está gozado, lo dice", async () => {
    servicio.misVacaciones.mockResolvedValue({
      ...MIAS,
      pendientes: 0,
      disponibles: 0,
      reservados: 0,
      en_curso: [],
      periodos_con_pendientes: 0,
      periodos: [MIAS.periodos[0]],
    });
    pintar();
    expect(
      await screen.findByText(/todos sus períodos están gozados/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^Período/ })).toBeNull();
    expect(
      screen.getByText("Sin días disponibles para pedir."),
    ).toBeInTheDocument();
  });

  it("sin períodos dice por qué y qué hacer", async () => {
    servicio.misVacaciones.mockResolvedValue({ ...MIAS, periodos: [] });
    pintar();
    expect(
      await screen.findByText(/Los carga Talento Humano/),
    ).toBeInTheDocument();
  });

  // Cargando y error (auditoría UX/UI, fase 2, 28/10/2026).
  it("dice «Cargando…» mientras llegan sus vacaciones", async () => {
    servicio.misVacaciones.mockReturnValue(new Promise(() => {}));
    pintar();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("si no cargan, lo dice y «Reintentar» las vuelve a pedir", async () => {
    servicio.misVacaciones.mockRejectedValueOnce({});
    pintar();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar sus vacaciones.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByText("Disponibles para pedir"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un fallo al buscar personas no se confunde con «nadie coincide»", async () => {
    permisos.lista = ["vacaciones.ver_todas", "licencias.solicitar"];
    servicio.personasVacaciones.mockRejectedValue({});
    pintar();
    fireEvent.click(
      await screen.findByText(/Consultar las vacaciones de otra persona/),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo buscar a las personas.",
    );
    expect(screen.queryByText(/Ningún resultado/)).toBeNull();
  });

  it("con permiso se consultan las de otra persona; el foco va al título", async () => {
    permisos.lista = ["vacaciones.ver_todas", "licencias.solicitar"];
    servicio.personasVacaciones.mockResolvedValue([
      {
        id: 9,
        nombre: "Beto Paz",
        pendientes: 12,
        disponibles: 1,
        periodos: 2,
      },
    ]);
    servicio.vacacionesDe.mockResolvedValue({
      ...MIAS,
      persona: { id: 9, nombre: "Beto Paz" },
    });
    pintar();
    fireEvent.click(
      await screen.findByText(/Consultar las vacaciones de otra persona/),
    );
    const boton = await screen.findByRole("button", { name: /Beto Paz/ });
    expect(boton).toHaveTextContent("1 día disponible");
    fireEvent.click(boton);
    const titulo = await screen.findByRole("heading", {
      name: "Vacaciones de Beto Paz",
    });
    await waitFor(() => expect(titulo).toHaveFocus());
    expect(servicio.vacacionesDe).toHaveBeenCalledWith(9);
    // De otra persona no se ofrece «Solicitar vacaciones».
    expect(
      screen.queryByRole("link", { name: /Solicitar vacaciones/ }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Volver a las mías/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Mis vacaciones" }),
      ).toHaveFocus(),
    );
  });
});
