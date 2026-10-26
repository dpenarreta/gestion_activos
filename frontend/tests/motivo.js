import { fireEvent, screen, within } from "@testing-library/react";

/** El motivo con que las pruebas confirman los cambios al organigrama. */
export const MOTIVO = "Ajuste de prueba";

/**
 * Escribe el motivo en el diálogo que piden los cambios al organigrama
 * (bitácora, 26/10/2026) y lo confirma.
 */
export async function darMotivo(texto = MOTIVO) {
  const dialogo = await screen.findByRole("dialog", { name: /¿Por qué se/ });
  fireEvent.change(within(dialogo).getByLabelText("Motivo del cambio"), {
    target: { value: texto },
  });
  fireEvent.click(
    within(dialogo).getByRole("button", { name: /Guardar el cambio|Revertir/ }),
  );
}
