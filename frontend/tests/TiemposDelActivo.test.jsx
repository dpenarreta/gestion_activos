import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TiemposDelActivo } from "../src/pages/Admin/Activos/ActivoDetalle";

const TIEMPOS = {
  desde_compra_dias: 400,
  desde_ingreso_dias: 365,
  desde_primera_asignacion_dias: 300,
  con_custodio_actual_dias: 50,
  en_reparacion_dias: 15,
  en_reparacion_ahora_dias: 0,
  sin_uso_dias: 100,
  activo_real_dias: 250,
  medido_desde: "ingreso",
};

describe("Tiempos del activo (§10)", () => {
  it("muestra los siete tiempos del documento", () => {
    render(<TiemposDelActivo tiempos={TIEMPOS} />);

    expect(screen.getByText("Desde la compra")).toBeInTheDocument();
    expect(screen.getByText("Con quien responde por él")).toBeInTheDocument();
    expect(screen.getByText("Guardado sin uso")).toBeInTheDocument();
    expect(
      screen.getByText(/Tiempo activo real: 8 meses y 10 días/),
    ).toBeInTheDocument();
  });

  // Más de 30 días dejan de decirse en días: «400 días» obliga a dividir
  // mentalmente para saber si es mucho o poco.
  it("cuenta los tiempos largos en años y meses, sin perder los días", () => {
    render(<TiemposDelActivo tiempos={TIEMPOS} />);

    expect(screen.getByText("1 año, 1 mes y 10 días")).toBeInTheDocument();
    expect(screen.getByText("1 año y 5 días")).toBeInTheDocument();
    expect(screen.getByText("10 meses")).toBeInTheDocument();
    expect(screen.getByText("3 meses y 10 días")).toBeInTheDocument();
    // Y los cortos siguen en días, que es la unidad en la que se decide.
    expect(screen.getByText("15 días")).toBeInTheDocument();
  });

  it("dice desde dónde se midió el tiempo activo real", () => {
    /* Dos tiempos medidos desde bases distintas no son comparables entre
       equipos, así que la base se declara. */
    render(
      <TiemposDelActivo tiempos={{ ...TIEMPOS, medido_desde: "compra" }} />,
    );

    expect(screen.getByText(/Medido desde la compra/)).toBeInTheDocument();
  });

  it("avisa aparte de la reparación que sigue abierta", () => {
    /* Sumarla al acumulado escondería que el equipo está fuera ahora mismo. */
    render(
      <TiemposDelActivo
        tiempos={{ ...TIEMPOS, en_reparacion_ahora_dias: 7 }}
      />,
    );

    expect(
      screen.getByText(/Lleva 7 días en reparación sin cerrar/),
    ).toBeInTheDocument();
  });

  it("usa la rejilla compacta de la ficha, no columnas de Bootstrap", () => {
    /* Con `col-sm-5`/`col-sm-7` el valor quedaba a media pantalla de su
       etiqueta en un monitor ancho, y la tarjeta se estiraba hasta desbordar
       sobre la bitácora. */
    const { container } = render(<TiemposDelActivo tiempos={TIEMPOS} />);

    expect(container.querySelector(".activo-datos")).toBeInTheDocument();
    expect(container.querySelector(".row")).not.toBeInTheDocument();
  });

  it("no inventa un cero cuando el dato no existe", () => {
    /* Un equipo nunca asignado no lleva «0 días» con su custodio: no tiene. */
    render(
      <TiemposDelActivo
        tiempos={{
          ...TIEMPOS,
          con_custodio_actual_dias: null,
          desde_ingreso_dias: null,
        }}
      />,
    );

    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
