import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnuncioDeResultados } from "../src/components/common/AnuncioDeResultados/AnuncioDeResultados";
import {
  ESPERA_BUSQUEDA_MS,
  useBusquedaEnVivo,
  useResultadosEnVivo,
} from "../src/hooks/useBusquedaEnVivo";
import { coincideBusqueda, normalizarBusqueda } from "../src/utils/busqueda";

/*
 * La búsqueda en vivo (06/11/2026): todos los buscadores filtran mientras se
 * escribe. Lo común —esperar a que se deje de teclear, que Enter no espere
 * (la pistola lectora), no repetir consultas iguales y que una respuesta
 * vieja no pise a una nueva— vive en estos hooks; aquí se prueba eso.
 */

function Buscador({ alBuscar, inicial }) {
  const busqueda = useBusquedaEnVivo({ alBuscar, inicial });
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        busqueda.buscarYa();
      }}
    >
      <input type="search" aria-label="Buscar" {...busqueda.propsCampo} />
      <button type="button" onClick={busqueda.limpiar}>
        Limpiar
      </button>
      <button type="button" onClick={() => busqueda.fijar("de fuera")}>
        Fijar
      </button>
      <output data-testid="termino">{busqueda.termino}</output>
    </form>
  );
}

describe("useBusquedaEnVivo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("busca al dejar de escribir, una vez y no en cada tecla", () => {
    const alBuscar = vi.fn();
    render(<Buscador alBuscar={alBuscar} />);
    const campo = screen.getByLabelText("Buscar");

    fireEvent.change(campo, { target: { value: "m" } });
    fireEvent.change(campo, { target: { value: "ma" } });
    fireEvent.change(campo, { target: { value: "mar" } });
    act(() => vi.advanceTimersByTime(ESPERA_BUSQUEDA_MS - 1));
    expect(alBuscar).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(alBuscar).toHaveBeenCalledTimes(1);
    expect(alBuscar).toHaveBeenCalledWith("mar");
    expect(screen.getByTestId("termino")).toHaveTextContent("mar");
  });

  it("Enter busca de inmediato, sin esperar: la pistola no nota la pausa", () => {
    const alBuscar = vi.fn();
    render(<Buscador alBuscar={alBuscar} />);
    const campo = screen.getByLabelText("Buscar");

    // La lectora teclea el código de golpe y cierra con Enter.
    fireEvent.change(campo, { target: { value: "GA-LAP-000007" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(alBuscar).toHaveBeenCalledWith("GA-LAP-000007");

    // El `submit` que acompaña al Enter y la espera vencida no repiten.
    fireEvent.submit(campo.closest("form"));
    act(() => vi.advanceTimersByTime(ESPERA_BUSQUEDA_MS * 2));
    expect(alBuscar).toHaveBeenCalledTimes(1);
  });

  it("vaciar el campo vuelve a la lista entera al instante", () => {
    const alBuscar = vi.fn();
    render(<Buscador alBuscar={alBuscar} inicial="ana" />);
    const campo = screen.getByLabelText("Buscar");
    expect(campo).toHaveValue("ana");

    fireEvent.change(campo, { target: { value: "" } });
    expect(alBuscar).toHaveBeenCalledWith("");
  });

  it("no busca de nuevo lo que ya está aplicado (solo cambian espacios)", () => {
    const alBuscar = vi.fn();
    render(<Buscador alBuscar={alBuscar} inicial="ana" />);
    fireEvent.change(screen.getByLabelText("Buscar"), {
      target: { value: "ana  " },
    });
    act(() => vi.advanceTimersByTime(ESPERA_BUSQUEDA_MS));
    expect(alBuscar).not.toHaveBeenCalled();
  });

  it("limpiar vacía y busca; fijar pone el texto sin buscar", () => {
    const alBuscar = vi.fn();
    render(<Buscador alBuscar={alBuscar} inicial="ana" />);
    const campo = screen.getByLabelText("Buscar");

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    expect(campo).toHaveValue("");
    expect(alBuscar).toHaveBeenCalledWith("");

    alBuscar.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Fijar" }));
    expect(campo).toHaveValue("de fuera");
    act(() => vi.advanceTimersByTime(ESPERA_BUSQUEDA_MS));
    expect(alBuscar).not.toHaveBeenCalled();
  });
});

function Resultados({ consultar }) {
  const [texto, setTexto] = useState("");
  const { datos, cargando } = useResultadosEnVivo(texto, consultar);
  return (
    <>
      <input
        aria-label="Persona"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <ul aria-busy={cargando}>
        {(datos ?? []).map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}

describe("useResultadosEnVivo", () => {
  it("una respuesta vieja y lenta no pisa a la del texto vigente", async () => {
    vi.useFakeTimers();
    try {
      const pendientes = {};
      const consultar = vi.fn(
        (q) =>
          new Promise((resolver) => {
            pendientes[q] = resolver;
          }),
      );
      render(<Resultados consultar={consultar} />);
      // La carga inicial (texto vacío) sale sin espera.
      await act(async () => vi.advanceTimersByTime(0));
      await act(async () => pendientes[""](["Todos"]));
      expect(screen.getByText("Todos")).toBeInTheDocument();

      const campo = screen.getByLabelText("Persona");
      fireEvent.change(campo, { target: { value: "ma" } });
      await act(async () => vi.advanceTimersByTime(ESPERA_BUSQUEDA_MS));
      fireEvent.change(campo, { target: { value: "maría" } });
      await act(async () => vi.advanceTimersByTime(ESPERA_BUSQUEDA_MS));
      expect(consultar).toHaveBeenCalledWith("ma");
      expect(consultar).toHaveBeenCalledWith("maría");

      // Mientras tanto la lista anterior sigue, marcada como ocupada.
      expect(screen.getByText("Todos")).toBeInTheDocument();
      expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");

      // Llega primero la nueva y después la vieja: gana la nueva.
      await act(async () => pendientes["maría"](["María Pérez"]));
      await act(async () => pendientes.ma(["Mario", "Marta"]));
      expect(screen.getByText("María Pérez")).toBeInTheDocument();
      expect(screen.queryByText("Mario")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("coincideBusqueda", () => {
  it("no distingue tildes ni mayúsculas, y cada palabra va en cualquier orden", () => {
    expect(normalizarBusqueda("  José PÉREZ ")).toBe("jose perez");
    expect(coincideBusqueda("jose perez", "Pérez Andrade, José")).toBe(true);
    expect(coincideBusqueda("quito norte", "Bodega Norte", "Quito")).toBe(true);
    expect(coincideBusqueda("quito sur", "Bodega Norte", "Quito")).toBe(false);
    expect(coincideBusqueda("", "lo que sea")).toBe(true);
    expect(coincideBusqueda("123", null, undefined, 1234)).toBe(true);
  });
});

describe("AnuncioDeResultados", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("siempre montada, anuncia el total cuando el resultado se queda quieto", () => {
    const { rerender } = render(<AnuncioDeResultados termino="" total={10} />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();

    rerender(<AnuncioDeResultados termino="ana" total={3} cargando />);
    act(() => vi.advanceTimersByTime(2000));
    // No mientras la consulta viaja.
    expect(region).toBeEmptyDOMElement();

    rerender(<AnuncioDeResultados termino="ana" total={3} />);
    act(() => vi.advanceTimersByTime(600));
    expect(region).toHaveTextContent("3 resultados");

    rerender(<AnuncioDeResultados termino="zzz" total={0} />);
    act(() => vi.advanceTimersByTime(600));
    expect(region).toHaveTextContent("Sin resultados para «zzz»");
  });

  it("con menos a la vista que en total, lo dice con su sustantivo", () => {
    render(
      <AnuncioDeResultados
        termino="lap"
        total={6}
        de={12}
        sustantivo={["sugerencia", "sugerencias"]}
        restoEnVerTodos
      />,
    );
    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByRole("status")).toHaveTextContent(
      "6 sugerencias de 12; «Ver todos» para el resto",
    );
  });
});

describe("useListadoPaginado: refresco silencioso", () => {
  it("el refresco automático no enciende la carga (no atenúa ni anuncia)", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useListadoPaginado } =
      await import("../src/hooks/useListadoPaginado");
    let resolver;
    const cargar = vi.fn(() =>
      cargar.mock.calls.length === 1
        ? Promise.resolve({ results: [1], count: 1 })
        : new Promise((r) => {
            resolver = r;
          }),
    );
    const { result } = renderHook(() => useListadoPaginado(cargar, {}));
    await act(async () => {});
    expect(result.current.isLoading).toBe(false);

    // La Bandeja cada 30 s.
    act(() => {
      result.current.refresh({ silencioso: true });
    });
    expect(result.current.isLoading).toBe(false);
    await act(async () => resolver({ results: [1, 2], count: 2 }));
    expect(result.current.resultados).toEqual([1, 2]);

    // Reintentar desde un botón (llega el evento del clic) sí la enciende.
    act(() => {
      result.current.refresh({ type: "click" });
    });
    expect(result.current.isLoading).toBe(true);
    await act(async () => resolver({ results: [], count: 0 }));
  });
});
