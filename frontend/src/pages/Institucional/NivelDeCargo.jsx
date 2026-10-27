import { createContext, useContext } from "react";

/** Los niveles de cargo del organigrama, para no pasarlos nodo por nodo. */
export const NivelesDeCargo = createContext([]);

/**
 * El nivel jerárquico de un cargo (27/10/2026): Gerencia General › Gerencia
 * de Área › Jefatura › Coordinación › Operativo de área › Asistente de área.
 * Los nombres vienen del servidor (`niveles_cargo` del organigrama), por
 * `datos` o por el contexto `NivelesDeCargo`; cada nivel lleva su tono.
 */
export function NivelDeCargo({ valor, datos, compacto = false }) {
  const delContexto = useContext(NivelesDeCargo);
  const niveles = datos?.niveles_cargo ?? delContexto;
  const nivel = niveles.find((n) => n.valor === valor);
  if (!nivel) return null;
  return (
    <span
      className={`org-nivel org-nivel--${nivel.valor}${compacto ? " org-nivel--compacto" : ""}`}
    >
      <span className="visually-hidden">Nivel jerárquico: </span>
      {nivel.nombre}
    </span>
  );
}
