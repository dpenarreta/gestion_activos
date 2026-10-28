import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "../src/context/UnsavedChangesContext";

/*
 * Una pantalla que calcula si tiene cambios (el editor de dashboards) registra
 * esa función en el contexto común, y salir por el menú pregunta «¿Descartar
 * los cambios?» igual que con un formulario (auditoría UX/UI, fase 3).
 */

function Editor({ sucio }) {
  const { registrarVerificador, guardedNavigate } = useUnsavedChanges();
  useEffect(
    () => registrarVerificador(() => sucio),
    [registrarVerificador, sucio],
  );
  return (
    <button type="button" onClick={() => guardedNavigate("/otra")}>
      Ir a otra pantalla
    </button>
  );
}

function pintar(sucio) {
  render(
    <MemoryRouter initialEntries={["/editor"]}>
      <UnsavedChangesProvider>
        <Routes>
          <Route path="/editor" element={<Editor sucio={sucio} />} />
          <Route path="/otra" element={<p>Otra pantalla</p>} />
        </Routes>
      </UnsavedChangesProvider>
    </MemoryRouter>,
  );
}

describe("Cambios sin guardar calculados por la pantalla", () => {
  it("con cambios, pregunta antes de salir y «Seguir editando» se queda", async () => {
    pintar(true);
    fireEvent.click(screen.getByRole("button", { name: "Ir a otra pantalla" }));
    const pregunta = await screen.findByRole("dialog", {
      name: "¿Descartar los cambios?",
    });
    fireEvent.click(
      within(pregunta).getByRole("button", { name: "Seguir editando" }),
    );
    expect(
      await screen.findByRole("button", { name: "Ir a otra pantalla" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Otra pantalla")).toBeNull();
  });

  it("sin cambios, sale directo", async () => {
    pintar(false);
    fireEvent.click(screen.getByRole("button", { name: "Ir a otra pantalla" }));
    expect(await screen.findByText("Otra pantalla")).toBeInTheDocument();
  });
});
