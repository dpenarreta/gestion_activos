import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useChat } from "../../components/admin/Chat/ChatContext";
import { Conversacion } from "../../components/admin/Chat/Conversacion";
import {
  Directorio,
  Grupos,
  ListaConversaciones,
} from "../../components/admin/Chat/Panel";
import "../../components/admin/Chat/ChatDock.css";
import { Icon } from "../../components/common/Icon/Icon";

const PESTANAS = [
  ["conversaciones", "Chats"],
  ["personas", "Personas"],
  ["grupos", "Grupos"],
];

/**
 * El chat a pantalla completa. Aquí llegan los enlaces de la campana
 * (`/admin/chat?c=<id>`) y es la vista del celular.
 */
export function ChatPage() {
  const chat = useChat();
  const [parametros, setParametros] = useSearchParams();
  const [pestana, setPestana] = useState("conversaciones");
  const activa = Number(parametros.get("c")) || null;
  const conversacion = chat?.conversaciones.find((c) => c.id === activa);

  const leer = chat?.leer;
  const pendientes = activa ? (chat?.noLeidos[activa] ?? 0) : 0;
  useEffect(() => {
    // Lo que llega a la conversación que se está viendo, queda leído.
    if (activa && leer && !document.hidden) {
      leer(activa);
    }
  }, [activa, leer, pendientes]);

  if (!chat) return null;

  function elegir(id) {
    setParametros({ c: String(id) });
    setPestana("conversaciones");
  }

  return (
    <div className={`chat-pagina${activa ? " chat-pagina--con-activa" : ""}`}>
      <aside className="chat-pagina__lateral">
        <div className="chat-panel__pestanas" role="tablist">
          {PESTANAS.map(([id, texto]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={pestana === id}
              className={pestana === id ? "activa" : undefined}
              onClick={() => setPestana(id)}
            >
              {texto}
            </button>
          ))}
        </div>
        <div className="chat-panel__cuerpo">
          {pestana === "conversaciones" && (
            <ListaConversaciones onElegir={elegir} activa={activa} />
          )}
          {pestana === "personas" && <Directorio onElegida={elegir} />}
          {pestana === "grupos" && <Grupos onElegir={elegir} activa={activa} />}
        </div>
      </aside>
      <section className="chat-pagina__principal">
        {conversacion ? (
          <>
            <header
              className={`chat-pagina__titulo${
                conversacion.tipo !== "directa"
                  ? " chat-pagina__titulo--grupo"
                  : ""
              }`}
            >
              <button
                type="button"
                className="btn btn-link btn-sm p-0 me-2 d-sm-none"
                aria-label="Volver a los chats"
                onClick={() => setParametros({})}
              >
                <Icon name="arrow-left" />
              </button>
              <strong>{conversacion.nombre}</strong>
              {conversacion.tipo !== "directa" && (
                <span className="mz-small mz-faint ms-2">
                  {conversacion.miembros} persona(s)
                </span>
              )}
            </header>
            <Conversacion conversacion={conversacion} />
          </>
        ) : (
          <div className="mz-empty m-auto">
            <Icon name="chat-dots" /> Elija una conversación o busque a una
            persona.
          </div>
        )}
      </section>
    </div>
  );
}
