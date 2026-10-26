import { Icon } from "../../components/common/Icon/Icon";

/** Las mismas insignias del historial por empleado. */
const CLASE_CONFORMIDAD = {
  conforme: "perfil-cargo-estado--completo",
  conforme_al_cerrar: "perfil-cargo-estado--parcial",
  observacion: "sugerencia-estado--alto",
};

function momento(m) {
  return `${m.dia} ${m.fecha} · ${m.hora.slice(0, 5)}${m.ip ? ` · IP ${m.ip}` : ""}`;
}

/**
 * La constancia de un rol de pagos (26/10/2026): cuándo se abrió —que es
 * cuando se aceptaron los términos— y cuándo se dio la conformidad, cada una
 * con día, fecha, hora e IP. Sin conformidad, queda como pendiente.
 */
export function ConstanciaRol({ rol }) {
  return (
    <div className="rol-constancia">
      <span
        className="rol-constancia__etiqueta rol-constancia__etiqueta--abierto"
        title={
          rol.veces > 1
            ? `Lo abrió ${rol.veces} veces; esta es la primera.`
            : ""
        }
      >
        <Icon name="envelope-open" /> Abierto y términos aceptados ·{" "}
        {momento(rol.abierto)}
      </span>
      {rol.conformidad ? (
        <span
          className={`rol-constancia__etiqueta perfil-cargo-estado ${CLASE_CONFORMIDAD[rol.conformidad] ?? ""}`}
        >
          <Icon
            name={
              rol.conformidad === "observacion"
                ? "chat-left-dots"
                : "check2-circle"
            }
          />{" "}
          {rol.conformidad_display}
          {rol.conformidad_en && ` · ${momento(rol.conformidad_en)}`}
        </span>
      ) : (
        <span className="rol-constancia__etiqueta perfil-cargo-estado perfil-cargo-estado--vacio">
          <Icon name="hourglass-split" /> Conformidad pendiente
        </span>
      )}
    </div>
  );
}
