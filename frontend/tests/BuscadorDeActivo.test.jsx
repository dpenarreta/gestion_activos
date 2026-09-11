import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Elegir el equipo escribiendo o disparando la pistola.
 *
 * Sustituye a un desplegable con el parque entero, que además se pedía con un
 * tope de trescientos: en un inventario del tamaño que el documento dimensiona
 * —entre cinco y diez mil equipos— el trescientos uno no se podía elegir, y sin
 * ningún aviso. Aquí se pregunta al servidor, así que no hay tope.
 *
 * Lo que estas pruebas fijan es el comportamiento con la pistola, que es el uso
 * real: teclea el código de golpe y cierra con Enter, y ese Enter no debe
 * enviar el formulario a medio llenar.
 */

const listar = vi.fn();
const obtener = vi.fn();

vi.mock("../src/api/activosService", () => ({
  activosService: {
    list: (...args) => listar(...args),
    get: (...args) => obtener(...args),
  },
}));

const { BuscadorDeActivo } =
  await import("../src/components/activos/BuscadorDeActivo/BuscadorDeActivo");

const LAPTOP = {
  id: 7,
  codigo_barras: "GA-LAP-000007",
  nombre: "Laptop Jefatura TI",
  marca: "Dell",
  modelo: "Latitude 5440",
  numero_serie: "DL5440-0011",
  responsables_resumen: "María Salazar",
};

const IMPRESORA = {
  id: 8,
  codigo_barras: "GA-IMP-000008",
  nombre: "Laptop Bodega",
  marca: "HP",
  modelo: "M404",
  numero_serie: "HP404-0022",
  responsables_resumen: "",
};

const onChange = vi.fn();

function pintar(props = {}) {
  return render(
    <BuscadorDeActivo valor="" onChange={onChange} requerido {...props} />,
  );
}

/** Teclea en el campo, como haría una persona o una pistola. */
function teclear(texto) {
  fireEvent.change(screen.getByLabelText("Activo intervenido"), {
    target: { value: texto },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  listar.mockResolvedValue({ results: [LAPTOP, IMPRESORA] });
  obtener.mockResolvedValue(LAPTOP);
});

// --- La pistola -------------------------------------------------------------

describe("Disparar la pistola sobre la etiqueta", () => {
  it("un código que identifica a un solo equipo lo elige solo", async () => {
    /* Es lo que ocurre siempre con un código de barras, y es el uso para el
       que existe el campo. */
    listar.mockResolvedValue({ results: [LAPTOP] });

    pintar();
    teclear("GA-LAP-000007");
    fireEvent.keyDown(screen.getByLabelText("Activo intervenido"), {
      key: "Enter",
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("7", LAPTOP));
  });

  it("el Enter de la pistola no envía el formulario a medio llenar", async () => {
    /* Sin cortarlo, cada lectura mandaría la intervención con el responsable y
       el trabajo realizado todavía vacíos. */
    const enviar = vi.fn((evento) => evento.preventDefault());
    listar.mockResolvedValue({ results: [LAPTOP] });

    render(
      <form onSubmit={enviar}>
        <BuscadorDeActivo valor="" onChange={onChange} />
      </form>,
    );
    teclear("GA-LAP-000007");
    fireEvent.keyDown(screen.getByLabelText("Activo intervenido"), {
      key: "Enter",
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(enviar).not.toHaveBeenCalled();
  });

  it("busca sin esperar al temporizador: la pistola no hace pausas", async () => {
    listar.mockResolvedValue({ results: [LAPTOP] });

    pintar();
    teclear("GA-LAP-000007");
    fireEvent.keyDown(screen.getByLabelText("Activo intervenido"), {
      key: "Enter",
    });

    await waitFor(() => expect(listar).toHaveBeenCalled());
    expect(listar.mock.calls[0][0]).toMatchObject({
      q: "GA-LAP-000007",
      operativos: "true",
    });
  });
});

// --- Escribir ---------------------------------------------------------------

describe("Escribir unas letras", () => {
  it("filtra contra el servidor y muestra las coincidencias", async () => {
    pintar();
    teclear("laptop");

    expect(await screen.findByText("Laptop Jefatura TI")).toBeInTheDocument();
    expect(screen.getByText("Laptop Bodega")).toBeInTheDocument();
    expect(listar.mock.calls.at(-1)[0]).toMatchObject({ q: "laptop" });
  });

  it("no pregunta por una sola letra", async () => {
    /* Con una letra la respuesta sería todo el parque y no ayudaría a nadie. */
    pintar();
    teclear("l");

    await waitFor(() =>
      expect(
        screen.getByText(/Escriba al menos dos caracteres/),
      ).toBeInTheDocument(),
    );
    expect(listar).not.toHaveBeenCalled();
  });

  it("con varias coincidencias, Enter confirma la resaltada", async () => {
    /* Como en cualquier desplegable con teclado: la primera viene resaltada y
       las flechas mueven el resalte. */
    pintar();
    teclear("laptop");
    await screen.findByText("Laptop Jefatura TI");

    fireEvent.keyDown(screen.getByLabelText("Activo intervenido"), {
      key: "Enter",
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("7", LAPTOP));
  });

  it("se elige con el ratón", async () => {
    pintar();
    teclear("laptop");

    fireEvent.click(await screen.findByText("Laptop Bodega"));

    expect(onChange).toHaveBeenCalledWith("8", IMPRESORA);
  });

  it("se baja por la lista con las flechas", async () => {
    pintar();
    teclear("laptop");
    await screen.findByText("Laptop Bodega");

    const campo = screen.getByLabelText("Activo intervenido");
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("8", IMPRESORA));
  });

  it("sin coincidencias lo dice, con el término buscado", async () => {
    /* Con el equipo en la mano, que no aparezca suele significar que está dado
       de baja o que la etiqueta es de otra empresa. */
    listar.mockResolvedValue({ results: [] });

    pintar();
    teclear("no-existe");

    expect(
      await screen.findByText(
        /Ningún equipo operativo coincide con «no-existe»/,
      ),
    ).toBeInTheDocument();
  });

  it("si la búsqueda falla, lo dice en vez de parecer que no hay nada", async () => {
    listar.mockRejectedValue(new Error("500"));

    pintar();
    teclear("laptop");

    expect(
      await screen.findByText("No se pudo buscar. Inténtelo de nuevo."),
    ).toBeInTheDocument();
  });
});

// --- El equipo ya elegido ---------------------------------------------------

describe("Cuando ya hay un equipo elegido", () => {
  it("se muestra con lo que sirve para reconocerlo", async () => {
    pintar({ valor: "7" });

    expect(await screen.findByText("GA-LAP-000007")).toBeInTheDocument();
    expect(
      screen.getByText(/Dell Latitude 5440 · DL5440-0011/),
    ).toBeInTheDocument();
    expect(obtener).toHaveBeenCalledWith("7");
  });

  it("se puede cambiar", async () => {
    pintar({ valor: "7" });
    await screen.findByText("GA-LAP-000007");

    fireEvent.click(screen.getByRole("button", { name: "Cambiar" }));

    expect(onChange).toHaveBeenCalledWith("", null);
    expect(screen.getByLabelText("Activo intervenido")).toBeInTheDocument();
  });

  it("bloqueado no ofrece cambiarlo", async () => {
    /* Una intervención no cambia de activo: en la edición el equipo se enseña,
       no se elige. */
    pintar({ valor: "7", disabled: true });
    await screen.findByText("GA-LAP-000007");

    expect(
      screen.queryByRole("button", { name: "Cambiar" }),
    ).not.toBeInTheDocument();
  });

  it("si no se puede cargar el equipo preseleccionado, lo dice", async () => {
    obtener.mockRejectedValue(new Error("404"));

    pintar({ valor: "7" });

    expect(
      await screen.findByText("No se pudo cargar el equipo seleccionado."),
    ).toBeInTheDocument();
  });
});
