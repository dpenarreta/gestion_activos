import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import { inicioService } from "../src/api/servicios";
import {
  datosDelEvento,
  diasDeLaCuadricula,
  nombreDelDia,
  porDia,
  rango,
  tituloDelMes,
} from "../src/inicio/calendario";
import { CalendarioInicio } from "../src/pantallas/CalendarioInicio";

jest.mock("../src/api/servicios", () => ({
  inicioService: { calendario: jest.fn() },
}));

// Lunes 16 de noviembre de 2026, 10:00 en Ecuador.
const AHORA = new Date("2026-11-16T15:00:00Z");

const FECHAS = [
  {
    id: 1,
    titulo: "Día de la Independencia de Cuenca",
    tipo: "feriado",
    tipo_display: "Feriado",
    descripcion: "",
    fecha: "2026-11-03",
    fecha_fin: "2026-11-03",
    cada_anio: true,
  },
  {
    id: 2,
    titulo: "Cierre de inventario",
    tipo: "evento",
    tipo_display: "Evento",
    descripcion: "En todas las agencias",
    fecha: "2026-11-16",
    fecha_fin: "2026-11-17",
    cada_anio: false,
  },
  {
    id: "cumple-7",
    titulo: "Cumpleaños de Ana Pérez",
    tipo: "cumpleanos",
    tipo_display: "Cumpleaños",
    descripcion: "",
    fecha: "2026-11-16",
    fecha_fin: "2026-11-16",
    cada_anio: true,
  },
  {
    id: 3,
    titulo: "Navidad",
    tipo: "feriado",
    tipo_display: "Feriado",
    descripcion: "",
    fecha: "2026-12-25",
    fecha_fin: "2026-12-25",
    cada_anio: true,
  },
];

describe("lo puro del calendario", () => {
  test("la cuadrícula va de lunes a domingo, 6 semanas", () => {
    const dias = diasDeLaCuadricula(2026, 11);
    expect(dias).toHaveLength(42);
    // El 1 de noviembre de 2026 es domingo: la cuadrícula arranca el lunes 26/10.
    expect(dias[0]).toEqual({ iso: "2026-10-26", numero: 26, delMes: false, finDeSemana: false });
    expect(dias[6]).toEqual({ iso: "2026-11-01", numero: 1, delMes: true, finDeSemana: true });
  });

  test("una fecha de varios días cae en cada uno", () => {
    const mapa = porDia(FECHAS);
    expect(mapa["2026-11-16"].map((e) => e.id)).toEqual([2, "cumple-7"]);
    expect(mapa["2026-11-17"].map((e) => e.id)).toEqual([2]);
    expect(mapa["2026-11-18"]).toBeUndefined();
  });

  test("textos: mes, rango y datos", () => {
    expect(tituloDelMes(2026, 11)).toBe("Noviembre 2026");
    expect(rango("2026-02-16", "2026-02-17")).toBe("del 16 al 17 de febrero");
    expect(rango("2026-12-31", "2027-01-01")).toBe(
      "del 31 de diciembre al 1 de enero",
    );
    expect(datosDelEvento(FECHAS[1])).toBe(
      "Evento · del 16 al 17 de noviembre",
    );
    expect(datosDelEvento(FECHAS[3], { conDia: true })).toBe(
      "Feriado · viernes 25 de diciembre · cada año",
    );
  });

  test("el nombre del día dice qué tiene, sin depender del color", () => {
    const dia = { iso: "2026-11-16", numero: 16, delMes: true };
    expect(
      nombreDelDia(dia, [FECHAS[1], FECHAS[2]], { hoy: "2026-11-16" }),
    ).toBe("lunes 16 de noviembre, hoy, 1 evento, 1 cumpleaños");
    expect(nombreDelDia({ iso: "2026-11-20" }, [])).toBe(
      "viernes 20 de noviembre, sin fechas",
    );
  });
});

describe("<CalendarioInicio />", () => {
  beforeEach(() => {
    inicioService.calendario.mockReset();
    inicioService.calendario.mockResolvedValue(FECHAS);
  });

  test("pide la cuadrícula del mes y muestra lo de hoy y lo que viene", async () => {
    await render(<CalendarioInicio ahora={AHORA} />);
    expect(inicioService.calendario).toHaveBeenCalledWith(
      "2026-10-26",
      "2026-12-06",
    );
    await waitFor(() =>
      expect(screen.getByTestId("calendario-lista")).toBeTruthy(),
    );
    expect(screen.getByText("Hoy · lunes 16 de noviembre")).toBeTruthy();
    expect(screen.getByText("Cierre de inventario")).toBeTruthy();
    // En «Eventos y feriados» no salen los cumpleaños.
    expect(screen.queryByText("Cumpleaños de Ana Pérez")).toBeNull();
  });

  test("las celebraciones van en su pestaña", async () => {
    await render(<CalendarioInicio ahora={AHORA} />);
    await waitFor(() =>
      expect(screen.getByTestId("calendario-lista")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId("calendario-grupo-celebraciones"));
    expect(screen.getByText("Cumpleaños de Ana Pérez")).toBeTruthy();
    expect(screen.queryByText("Cierre de inventario")).toBeNull();
  });

  test("al tocar un día se listan sus fechas", async () => {
    await render(<CalendarioInicio ahora={AHORA} />);
    await waitFor(() =>
      expect(screen.getByTestId("calendario-lista")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId("calendario-dia-2026-11-03"));
    expect(screen.getByText("Martes 3 de noviembre")).toBeTruthy();
    expect(screen.getByText("Día de la Independencia de Cuenca")).toBeTruthy();
    expect(screen.getByTestId("calendario-hoy")).toBeTruthy();
  });

  test("cambia de mes y vuelve a hoy", async () => {
    await render(<CalendarioInicio ahora={AHORA} />);
    await waitFor(() =>
      expect(screen.getByTestId("calendario-lista")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId("calendario-mes-siguiente"));
    expect(screen.getByText("Diciembre 2026")).toBeTruthy();
    await waitFor(() =>
      expect(inicioService.calendario).toHaveBeenLastCalledWith(
        "2026-11-30",
        "2027-01-10",
      ),
    );
    await fireEvent.press(screen.getByTestId("calendario-hoy"));
    expect(screen.getByText("Noviembre 2026")).toBeTruthy();
  });

  test("si falla lo dice y deja reintentar", async () => {
    inicioService.calendario.mockRejectedValueOnce(new Error("red"));
    await render(<CalendarioInicio ahora={AHORA} />);
    await waitFor(() =>
      expect(screen.getByText("No se pudo cargar el calendario.")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByText("Reintentar"));
    await waitFor(() =>
      expect(screen.getByTestId("calendario-lista")).toBeTruthy(),
    );
  });
});
