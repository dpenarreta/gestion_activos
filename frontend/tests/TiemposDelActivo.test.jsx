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
    expect(screen.getByText("Con el custodio actual")).toBeInTheDocument();
    expect(screen.getByText("Guardado sin uso")).toBeInTheDocument();
    expect(
      screen.getByText(/Tiempo activo real: 250 día\(s\)/),
    ).toBeInTheDocument();
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
      screen.getByText(/7 día\(s\) en reparación sin cerrar/),
    ).toBeInTheDocument();
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
