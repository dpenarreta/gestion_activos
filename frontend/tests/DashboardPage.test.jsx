import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El panel principal: la pantalla desde la que se decide qué hacer hoy.
 *
 * Cada indicador es un enlace al listado que lo explica —un número que no lleva
 * a los equipos que lo componen obliga a reconstruir el filtro a mano— y varios
 * bloques solo aparecen cuando hay algo que decir. Eso último es lo que se
 * rompe sin que nadie lo note: un aviso que deja de salir no se echa de menos.
 *
 * El fixture reproduce la respuesta de `construir_indicadores` clave por clave;
 * un panel que se prueba contra una forma inventada pasa en verde mientras la
 * pantalla real muestra «undefined».
 */

const indicadores = vi.fn();

vi.mock("../src/api/activosService", () => ({
  dashboardService: { indicadores: (...args) => indicadores(...args) },
}));

const { DashboardPage } =
  await import("../src/pages/Admin/Dashboard/DashboardPage");

const DATOS = {
  activos: {
    total: 16,
    en_uso: 8,
    disponibles: 3,
    en_bodega: 4,
    en_mantenimiento: 1,
    en_garantia: 0,
    en_transito: 0,
    dados_de_baja: 0,
    perdidos: 0,
    robados: 0,
    operativos: 16,
    requieren_renovacion: 5,
    evaluar_reemplazo: 3,
    reemplazo_recomendado: 2,
    sin_asignar_mas_de_90_dias: 0,
  },
  mantenimientos: {
    del_mes: 1,
    total_historico: 17,
    costo_acumulado: "1438.50",
    costo_del_mes: "18.50",
    por_mes: [
      { mes: "2026-08-01", total: 3 },
      { mes: "2026-09-01", total: 1 },
    ],
    por_tipo: { correctivo: 12, preventivo: 5 },
  },
  garantias: {
    vencidas: 7,
    por_vencer: 1,
    vigentes: 8,
    sin_registrar: 0,
    dias_de_aviso: 30,
  },
  fuera_de_operacion: {
    total_dias: 41,
    intervenciones_cerradas: 13,
    intervenciones_abiertas: 4,
  },
  equipos_mas_reparados: [
    {
      id: 1,
      codigo_barras: "GA-LAP-000001",
      nombre: "Laptop Contabilidad 01",
      tipo: "Laptop",
      departamento: "Contabilidad",
      total_mantenimientos: 5,
      total_componentes_criticos: 1,
    },
  ],
  por_tipo_dispositivo: [
    { nombre_tipo: "Laptop", total: 9 },
    { nombre_tipo: "Impresora", total: 7 },
  ],
  por_departamento: [
    { nombre_departamento: "Tecnología", total: 9, asignados: 5 },
    { nombre_departamento: "Logística", total: 7, asignados: 3 },
  ],
  indicadores_no_disponibles: [],
};

function pintar(datos = DATOS) {
  indicadores.mockResolvedValue(datos);
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

/** La tarjeta completa a la que pertenece una etiqueta del panel. */
function tarjeta(etiqueta) {
  return screen.getByText(etiqueta).closest("a");
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Los indicadores del §15 ------------------------------------------------

describe("Panel principal", () => {
  it("muestra los indicadores del parque", async () => {
    pintar();

    expect(await screen.findByText("Activos registrados")).toBeInTheDocument();
    expect(tarjeta("Activos registrados")).toHaveTextContent("16");
    expect(tarjeta("Asignados")).toHaveTextContent("8");
    expect(tarjeta("En reparación")).toHaveTextContent("1");
    expect(tarjeta("Garantías vencidas")).toHaveTextContent("7");
  });

  it("«En almacén» junta los disponibles y los que están en bodega", async () => {
    /* Son dos estados distintos en la ficha, pero para decidir qué entregar
       hoy ambos están igual de libres: separarlos aquí haría creer que hay
       menos equipo disponible del que hay. */
    pintar();

    await screen.findByText("Activos registrados");
    expect(tarjeta("En almacén")).toHaveTextContent("7");
  });

  it("cada indicador lleva al listado que lo explica", async () => {
    /* Un número que no lleva a los equipos que lo componen obliga a
       reconstruir el filtro a mano, y entonces deja de consultarse. */
    pintar();

    await screen.findByText("Activos registrados");
    expect(tarjeta("Dados de baja")).toHaveAttribute(
      "href",
      "/admin/activos?estado=dado_de_baja",
    );
    expect(tarjeta("En reparación")).toHaveAttribute(
      "href",
      "/admin/activos?estado=en_mantenimiento",
    );
    expect(tarjeta("Reemplazo recomendado")).toHaveAttribute(
      "href",
      "/admin/activos?nivel_renovacion=recomendado",
    );
  });

  it("dice el plazo de aviso en la propia etiqueta de garantías", async () => {
    // «Por vencer» sin decir en cuánto tiempo no se puede interpretar.
    pintar();

    expect(
      await screen.findByText("Garantías por vencer (30 d)"),
    ).toBeInTheDocument();
  });

  it("resume la bitácora con el costo del mes y el acumulado", async () => {
    pintar();

    await screen.findByText("Activos registrados");
    expect(screen.getByText("Este mes").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("Histórico").previousSibling).toHaveTextContent(
      "17",
    );
    expect(screen.getByText("Costo del mes").previousSibling).toHaveTextContent(
      "18,50",
    );
  });

  it("el tiempo fuera de operación se lee en meses, no en días sueltos", async () => {
    pintar();

    expect(await screen.findByText(/1 mes y 11 días/)).toBeInTheDocument();
  });

  it("con equipos aún en el taller lo dice: ese tiempo todavía no está cerrado", async () => {
    /* El acumulado solo suma intervenciones cerradas; sin este añadido se
       leería como el total y saldría corto. */
    pintar();

    expect(
      await screen.findByText(/4 equipo\(s\) aún en reparación/),
    ).toBeInTheDocument();
  });

  it("mientras carga no muestra ceros que se leerían como «ninguno»", () => {
    indicadores.mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(screen.queryByText("Activos registrados")).not.toBeInTheDocument();
  });

  it("si no cargan, lo dice en vez de dejar la pantalla en blanco", async () => {
    indicadores.mockRejectedValue(new Error("500"));

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("No se pudieron cargar los indicadores."),
    ).toBeInTheDocument();
  });
});

// --- Lo que solo aparece cuando hace falta ----------------------------------

describe("Los avisos aparecen solo cuando hay algo que decir", () => {
  it("sin equipos perdidos ni robados no se dibuja esa tarjeta", async () => {
    pintar();

    await screen.findByText("Activos registrados");
    expect(screen.queryByText("Perdidos o robados")).not.toBeInTheDocument();
  });

  it("con alguno, la tarjeta aparece y suma los dos estados", async () => {
    pintar({
      ...DATOS,
      activos: { ...DATOS.activos, perdidos: 2, robados: 1 },
    });

    expect(await screen.findByText("Perdidos o robados")).toBeInTheDocument();
    expect(tarjeta("Perdidos o robados")).toHaveTextContent("3");
  });

  it("avisa de los equipos sin garantía registrada, y por qué importa", async () => {
    /* No entran en los conteos de arriba: sin decirlo, «7 vencidas» se leería
       como el total del parque. */
    pintar({ ...DATOS, garantias: { ...DATOS.garantias, sin_registrar: 3 } });

    expect(
      await screen.findByText(/no tienen fecha de garantía/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Completarlos" }),
    ).toBeInTheDocument();
  });

  it("sin ninguno, ese aviso no aparece", async () => {
    pintar();

    await screen.findByText("Activos registrados");
    expect(
      screen.queryByText(/no tienen fecha de garantía/),
    ).not.toBeInTheDocument();
  });

  it("avisa de lo que lleva demasiado en bodega sin asignarse", async () => {
    pintar({
      ...DATOS,
      activos: { ...DATOS.activos, sin_asignar_mas_de_90_dias: 4 },
    });

    expect(
      await screen.findByText(/llevan más de 90 días/),
    ).toBeInTheDocument();
  });

  it("dice qué indicadores del documento aún no se pueden calcular", async () => {
    /* Omitirlos en silencio, o mostrar un cero, haría creer que el dato es
       cero y no que todavía no se mide. */
    pintar({
      ...DATOS,
      indicadores_no_disponibles: [
        {
          clave: "depreciacion",
          motivo: "La depreciación no está implementada.",
        },
      ],
    });

    expect(
      await screen.findByText(/La depreciación no está implementada/),
    ).toBeInTheDocument();
  });
});

// --- Los bloques con listas -------------------------------------------------

describe("Los listados del panel", () => {
  it("lista los equipos más reparados con su tipo y su área", async () => {
    pintar();

    const fila = (await screen.findByText("Laptop Contabilidad 01")).closest(
      "a",
    );
    expect(fila).toHaveTextContent("Laptop · Contabilidad");
    expect(fila).toHaveTextContent("5");
    expect(fila).toHaveAttribute("href", "/admin/activos/1");
  });

  it("sin intervenciones no deja el bloque en blanco", async () => {
    pintar({ ...DATOS, equipos_mas_reparados: [] });

    expect(
      await screen.findByText("Sin intervenciones registradas."),
    ).toBeInTheDocument();
  });

  it("reparte el parque por tipo y por área", async () => {
    pintar();

    await screen.findByText("Activos registrados");
    const porArea = screen.getByText("Por área").closest(".card-body");
    expect(within(porArea).getByText("Tecnología")).toBeInTheDocument();
    // El total y los asignados van juntos: «9» sin más no dice cuántos de
    // esos nueve están en manos de alguien.
    expect(within(porArea).getByText("5 asignados")).toBeInTheDocument();

    const porTipo = screen
      .getByText("Por tipo de dispositivo")
      .closest(".card-body");
    expect(within(porTipo).getByText("Impresora")).toBeInTheDocument();
  });

  it("dibuja la tendencia de los últimos meses", async () => {
    pintar();

    const grafico = await screen.findByRole("img", {
      name: "Reparaciones por mes",
    });
    expect(within(grafico).getByText("ago 26")).toBeInTheDocument();
    expect(within(grafico).getByText("sep 26")).toBeInTheDocument();
  });

  it("sin reparaciones en el periodo lo dice en vez de un gráfico vacío", async () => {
    pintar({
      ...DATOS,
      mantenimientos: { ...DATOS.mantenimientos, por_mes: [] },
    });

    expect(
      await screen.findByText("Sin intervenciones en los últimos meses."),
    ).toBeInTheDocument();
  });
});
