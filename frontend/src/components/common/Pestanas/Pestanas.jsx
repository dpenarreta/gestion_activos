import { useRef } from "react";

import { Icon } from "../Icon/Icon";

/*
 * Pestañas accesibles, iguales en todo el sistema (auditoría UX/UI de todo el
 * sistema, fase 2, 28/10/2026): diez pantallas usaban role="tab" sin flechas
 * ni panel asociado. Patrón WAI-ARIA: una sola parada de Tab; flechas, Inicio
 * y Fin cambian de pestaña; cada pestaña dice qué panel controla.
 *
 *     <Pestanas etiqueta="Solicitudes" idBase="sp" valor={vista}
 *       onCambio={setVista}
 *       opciones={[{ id: "mias", etiqueta: "Mis solicitudes" }]} />
 *     <PanelDePestana idBase="sp" valor={vista}>…</PanelDePestana>
 *
 * Cada opción: `id`, `etiqueta`, y opcionales `icono`, `cuenta` (número que
 * se muestra al lado) y `unidad` (cómo se lee la cuenta: «pendientes»).
 */
export const idDePestana = (idBase, id) => `${idBase}-pestana-${id}`;
export const idDePanel = (idBase) => `${idBase}-panel`;

export function Pestanas({
  etiqueta,
  idBase,
  valor,
  onCambio,
  opciones,
  className = "",
}) {
  const botones = useRef({});
  const ids = opciones.map((o) => o.id);

  function teclas(evento) {
    const actual = ids.indexOf(valor);
    const destino = {
      ArrowRight: (actual + 1) % ids.length,
      ArrowLeft: (actual - 1 + ids.length) % ids.length,
      Home: 0,
      End: ids.length - 1,
    }[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    onCambio(ids[destino]);
    botones.current[ids[destino]]?.focus();
  }

  return (
    <div
      className={`mz-tabs ${className}`.trim()}
      role="tablist"
      aria-label={etiqueta}
    >
      {opciones.map((o) => (
        <button
          key={o.id}
          ref={(nodo) => {
            botones.current[o.id] = nodo;
          }}
          id={idDePestana(idBase, o.id)}
          type="button"
          role="tab"
          aria-selected={valor === o.id}
          aria-controls={idDePanel(idBase)}
          // Si el valor no está entre las opciones (aún no cargó), la
          // primera recibe el Tab: si no, ninguna se alcanzaba.
          tabIndex={
            valor === o.id || (!ids.includes(valor) && o.id === ids[0]) ? 0 : -1
          }
          className={valor === o.id ? "is-active" : undefined}
          onClick={() => onCambio(o.id)}
          onKeyDown={teclas}
        >
          {o.icono && <Icon name={o.icono} />} {o.etiqueta}
          {o.cuenta > 0 && (
            <span className="mz-tabs__cuenta">
              {o.cuenta}
              {o.unidad && <span className="visually-hidden"> {o.unidad}</span>}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function PanelDePestana({
  idBase,
  valor,
  className,
  sinPestanas = false,
  children,
}) {
  // Sin pestañas visibles, su `aria-labelledby` apuntaría a un id que no
  // existe: el contenido va sin envoltorio de panel.
  if (sinPestanas) return <div className={className}>{children}</div>;
  return (
    <div
      id={idDePanel(idBase)}
      role="tabpanel"
      aria-labelledby={idDePestana(idBase, valor)}
      className={className}
    >
      {children}
    </div>
  );
}
