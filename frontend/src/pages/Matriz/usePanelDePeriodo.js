import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * El período abierto en el panel lateral vive en la dirección (`?periodo=ID`):
 * se puede compartir, sobrevive a recargar y el botón «atrás» lo cierra. Es la
 * misma convención que el enlace de los correos de recordatorio (§12.5).
 */
export function usePanelDePeriodo() {
  const [params, setParams] = useSearchParams();
  const abierto = Number(params.get("periodo")) || null;

  const abrir = useCallback(
    (id) => {
      const siguientes = new URLSearchParams(params);
      siguientes.set("periodo", String(id));
      setParams(siguientes);
    },
    [params, setParams],
  );

  const cerrar = useCallback(() => {
    const siguientes = new URLSearchParams(params);
    siguientes.delete("periodo");
    setParams(siguientes);
  }, [params, setParams]);

  return { abierto, abrir, cerrar };
}
