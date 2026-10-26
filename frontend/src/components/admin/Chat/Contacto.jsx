import { useEffect, useState } from "react";

import { chatService } from "../../../api/chatService";
import { copiarTexto } from "../../../utils/copiar";
import { Icon } from "../../common/Icon/Icon";

/** Un dato del contacto: su etiqueta, el valor (se selecciona entero con un
 * clic, para copiarlo a mano) y el botón de copiar. */
function Dato({ etiqueta, valor, icono }) {
  const [copiado, setCopiado] = useState(null);

  useEffect(() => {
    if (copiado === null) return undefined;
    const espera = setTimeout(() => setCopiado(null), 2000);
    return () => clearTimeout(espera);
  }, [copiado]);

  return (
    <div className="chat-contacto__dato">
      <span className="chat-contacto__etiqueta">
        <Icon name={icono} /> {etiqueta}
      </span>
      <div className="chat-contacto__fila">
        <span className="chat-contacto__valor">{valor}</span>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          aria-label={`Copiar ${etiqueta.toLowerCase()}`}
          title="Copiar"
          onClick={async () => setCopiado(await copiarTexto(valor))}
        >
          <Icon name={copiado ? "check2" : "copy"} />
        </button>
      </div>
      {copiado !== null && (
        <small
          className={copiado ? "text-success" : "text-danger"}
          role="status"
        >
          {copiado ? "Copiado" : "No se pudo copiar: selecciónelo y cópielo."}
        </small>
      )}
    </div>
  );
}

/**
 * El contacto de una persona, desde el buscador del chat: su correo
 * institucional y, si lo autorizó en «Mi perfil», su teléfono. Lo que no
 * tiene no se muestra.
 */
export function TarjetaContacto({ persona }) {
  const [contacto, setContacto] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vigente = true;
    chatService
      .contacto(persona.id)
      .then((datos) => vigente && setContacto(datos))
      .catch(() => vigente && setError(true));
    return () => {
      vigente = false;
    };
  }, [persona.id]);

  return (
    <div
      className="chat-contacto"
      role="region"
      aria-label={`Contacto de ${persona.nombre}`}
    >
      {error && (
        <p className="mz-small text-danger mb-0">
          No se pudo cargar el contacto.
        </p>
      )}
      {!contacto && !error && (
        <p className="mz-small mz-faint mb-0">Cargando…</p>
      )}
      {contacto && (
        <>
          {(contacto.cargo || contacto.area) && (
            <p className="mz-small mz-faint mb-0">
              {[contacto.cargo, contacto.area].filter(Boolean).join(" · ")}
            </p>
          )}
          {contacto.correo && (
            <Dato
              etiqueta="Correo institucional"
              icono="envelope"
              valor={contacto.correo}
            />
          )}
          {contacto.telefono && (
            <Dato
              etiqueta="Teléfono"
              icono="telephone"
              valor={contacto.telefono}
            />
          )}
          {!contacto.correo && !contacto.telefono && (
            <p className="mz-small mz-faint mb-0">
              No tiene datos de contacto para mostrar.
            </p>
          )}
        </>
      )}
    </div>
  );
}
