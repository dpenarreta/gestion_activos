import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * En línea y última conexión (22/10/2026): el punto verde, el texto y la
 * consulta al servidor de las personas que se ven.
 */

const presencia = vi.fn();
vi.mock("../src/api/chatService", () => ({ chatService: { presencia } }));

const { Presencia, textoPresencia, usePresencia } =
  await import("../src/components/admin/Chat/Presencia");

function Prueba({ ids }) {
  const estados = usePresencia(ids);
  return (
    <ul>
      {ids.map((id) => (
        <li key={id}>
          <Presencia estado={estados[id]} conTexto />
        </li>
      ))}
    </ul>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("La presencia", () => {
  it("dice en línea o la última conexión", () => {
    expect(textoPresencia({ en_linea: true })).toBe("En línea");
    const hace = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(textoPresencia({ en_linea: false, ultima_conexion: hace })).toBe(
      "Última conexión: hace 5 min",
    );
    expect(textoPresencia({ en_linea: false, ultima_conexion: null })).toBe(
      "Sin conexiones",
    );
  });

  it("pregunta por las personas que se ven y pinta su estado", async () => {
    presencia.mockResolvedValue({
      7: { en_linea: true, ultima_conexion: new Date().toISOString() },
      9: { en_linea: false, ultima_conexion: null },
    });
    render(<Prueba ids={[7, 9]} />);
    await waitFor(() => expect(presencia).toHaveBeenCalledWith(["7", "9"]));
    expect(await screen.findByText("En línea")).toBeInTheDocument();
    expect(screen.getByText("Sin conexiones")).toBeInTheDocument();
    expect(screen.getByText("En línea").closest(".presencia")).toHaveClass(
      "presencia--en-linea",
    );
  });
});
