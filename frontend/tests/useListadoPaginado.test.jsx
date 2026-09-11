import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useListadoPaginado } from "../src/hooks/useListadoPaginado";

/*
 * El hook que sostiene los cinco listados del dominio.
 *
 * Lo que se prueba aquí es la carrera: dos peticiones pueden estar en vuelo a
 * la vez —se escribe un filtro mientras la carga inicial todavía viaja— y no
 * llegan necesariamente en el orden en que se pidieron. Sin un guardián, gana
 * la última en llegar y la pantalla acaba mostrando el listado sin filtrar con
 * el filtro escrito en la caja.
 *
 * Lo encontró la suite de extremo a extremo, de forma intermitente: justo
 * después de cambiar de empresa —cuando media docena de peticiones compiten—
 * el inventario se quedaba con el listado entero después de buscar.
 */

/** Una promesa que se resuelve cuando la prueba quiera. */
function diferida() {
  let resolver;
  const promesa = new Promise((listo) => {
    resolver = listo;
  });
  return { promesa, resolver };
}

function pagina(resultados) {
  return { results: resultados, count: resultados.length, next: null, previous: null };
}

const cargar = vi.fn();

/**
 * Un listado de juguete que filtra como filtran las pantallas de verdad.
 *
 * El filtro se cambia con `actualizarFiltros` y no volviendo a montar con otras
 * props: `filtrosIniciales` es solo el valor de arranque, y cambiarlo desde
 * fuera no dispara ninguna consulta —que es justamente como se comporta en la
 * aplicación—.
 */
function Listado() {
  const listado = useListadoPaginado(cargar, { q: "" });
  return (
    <div>
      <p data-testid="cargando">{listado.isLoading ? "sí" : "no"}</p>
      <button type="button" onClick={() => listado.actualizarFiltros({ q: "laptop" })}>
        Filtrar
      </button>
      <ul>
        {listado.resultados.map((fila) => (
          <li key={fila}>{fila}</li>
        ))}
      </ul>
    </div>
  );
}

/** Pinta el listado y cambia el filtro con la primera consulta en el aire. */
function pintarYFiltrar() {
  render(<Listado />);
  fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Dos consultas en vuelo a la vez", () => {
  it("la respuesta vieja no pisa a la nueva aunque llegue después", async () => {
    const inicial = diferida();
    const filtrada = diferida();
    cargar
      .mockReturnValueOnce(inicial.promesa)
      .mockReturnValueOnce(filtrada.promesa);

    // Se cambia el filtro con la primera todavía en el aire.
    pintarYFiltrar();

    // Y las respuestas llegan al revés: primero la filtrada, después la vieja.
    await act(async () => {
      filtrada.resolver(pagina(["Laptop Contabilidad"]));
      inicial.resolver(pagina(["Todo", "El", "Parque"]));
    });

    expect(screen.getByText("Laptop Contabilidad")).toBeInTheDocument();
    expect(screen.queryByText("El")).not.toBeInTheDocument();
  });

  it("tampoco apaga el indicador de carga de la consulta vigente", async () => {
    /* «Ya está» con la nueva todavía en camino deja leer una tabla vacía como
       si fuera el resultado. */
    const inicial = diferida();
    const filtrada = diferida();
    cargar
      .mockReturnValueOnce(inicial.promesa)
      .mockReturnValueOnce(filtrada.promesa);

    pintarYFiltrar();

    await act(async () => {
      inicial.resolver(pagina(["Todo", "El", "Parque"]));
    });

    expect(screen.getByTestId("cargando")).toHaveTextContent("sí");

    await act(async () => {
      filtrada.resolver(pagina(["Laptop Contabilidad"]));
    });

    expect(screen.getByTestId("cargando")).toHaveTextContent("no");
  });

  it("un error viejo tampoco tapa el resultado bueno", async () => {
    const inicial = diferida();
    const filtrada = diferida();
    cargar
      .mockReturnValueOnce(inicial.promesa)
      .mockReturnValueOnce(filtrada.promesa);

    pintarYFiltrar();

    await act(async () => {
      filtrada.resolver(pagina(["Laptop Contabilidad"]));
      inicial.resolver(Promise.reject(new Error("500")));
    });

    expect(screen.getByText("Laptop Contabilidad")).toBeInTheDocument();
  });
});
