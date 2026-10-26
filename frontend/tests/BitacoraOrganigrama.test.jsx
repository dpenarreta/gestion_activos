import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { darMotivo } from "./motivo";

/*
 * Bitácora del organigrama (26/10/2026): los 2 últimos cambios con quién,
 * cuándo, IP, motivo y qué cambió; revertir muestra antes qué va a pasar y
 * pide su propio motivo.
 */

const servicio = {
  versionesOrganigrama: vi.fn(),
  vistaPreviaRevertir: vi.fn(),
  revertirVersion: vi.fn(),
};
vi.mock("../src/api/institucionalService", () => ({
  institucionalService: servicio,
}));

const { BitacoraOrganigrama } =
  await import("../src/pages/Institucional/BitacoraOrganigrama");

const VERSIONES = [
  {
    id: 8,
    fecha: "26/10/2026",
    hora: "15:30:00",
    usuario: "Daniel Peñarreta",
    ip: "10.0.2.80",
    motivo: "Reestructuración aprobada por gerencia",
    cambios: ["Nuevo cargo «Asistente comercial»."],
    revierte: null,
  },
  {
    id: 7,
    fecha: "25/10/2026",
    hora: "09:00:00",
    usuario: "Daniel Peñarreta",
    ip: "10.0.2.80",
    motivo: "Cambio de jefe",
    cambios: ["Cargo «Analista»: jefe inmediato: Gerente → Coordinador."],
    revierte: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  servicio.versionesOrganigrama.mockResolvedValue(VERSIONES);
});

describe("Bitácora del organigrama", () => {
  it("muestra los 2 últimos cambios con quién, cuándo, IP, motivo y qué cambió", async () => {
    render(<BitacoraOrganigrama puedeRevertir={false} onCerrar={() => {}} />);
    expect(
      await screen.findByText("Reestructuración aprobada por gerencia"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nuevo cargo «Asistente comercial»."),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/IP 10\.0\.2\.80/)).toHaveLength(2);
    expect(screen.getByText("Último cambio")).toBeInTheDocument();
    // Sin `institucional.editar` no se revierte.
    expect(screen.queryByRole("button", { name: /Revertir/ })).toBeNull();
  });

  it("revertir muestra qué va a pasar y pide el motivo", async () => {
    servicio.vistaPreviaRevertir.mockResolvedValue([
      "Se borró el cargo «Asistente comercial».",
    ]);
    servicio.revertirVersion.mockResolvedValue({});
    const onRevertido = vi.fn();
    render(
      <BitacoraOrganigrama
        puedeRevertir
        onCerrar={() => {}}
        onRevertido={onRevertido}
      />,
    );
    const ultimo = (await screen.findByText("Último cambio")).closest(
      "article",
    );
    fireEvent.click(
      within(ultimo).getByRole("button", { name: /Revertir este cambio/ }),
    );
    expect(
      await within(ultimo).findByText(
        "Se borró el cargo «Asistente comercial».",
      ),
    ).toBeInTheDocument();
    expect(servicio.vistaPreviaRevertir).toHaveBeenCalledWith(8);
    fireEvent.click(
      within(ultimo).getByRole("button", { name: /Sí, revertir/ }),
    );
    await darMotivo("Se creó por error");
    await waitFor(() =>
      expect(servicio.revertirVersion).toHaveBeenCalledWith(
        8,
        "Se creó por error",
      ),
    );
    expect(onRevertido).toHaveBeenCalled();
    expect(
      await screen.findByText(/la estructura volvió a como estaba/),
    ).toBeInTheDocument();
  });
});
