import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { Icon } from "../../common/Icon/Icon";
import { useChat } from "./ChatContext";
import { Conversacion } from "./Conversacion";
import { Directorio, esGrupal, Grupos, ListaConversaciones } from "./Panel";
import "./ChatDock.css";

const PESTANAS = [
  ["conversaciones", "Chats"],
  ["personas", "Personas"],
  ["grupos", "Grupos"],
];

/** Una pestaña acoplada abajo: minimizada solo muestra su barra. */
function Ventana({ ventana }) {
  const chat = useChat();
  const conversacion = chat.conversaciones.find((c) => c.id === ventana.id);
  if (!conversacion) return null;
  const pendientes = chat.noLeidos[conversacion.id] ?? 0;
  return (
    <section
      className={`chat-ventana${ventana.abierta ? " chat-ventana--abierta" : ""}${
        esGrupal(conversacion) ? " chat-ventana--grupo" : ""
      }`}
      aria-label={`Chat: ${conversacion.nombre}`}
    >
      <header className="chat-ventana__barra">
        <button
          type="button"
          className="chat-ventana__titulo"
          aria-expanded={ventana.abierta}
          onClick={() => chat.alternar(conversacion.id)}
        >
          <span>{conversacion.nombre}</span>
          {pendientes > 0 && (
            <span
              className="chat-contador"
              aria-label={`${pendientes} sin leer`}
            >
              {pendientes}
            </span>
          )}
        </button>
        <button
          type="button"
          className="chat-ventana__accion"
          aria-label={ventana.abierta ? "Minimizar" : "Abrir"}
          onClick={() => chat.alternar(conversacion.id)}
        >
          <Icon name={ventana.abierta ? "dash-lg" : "chevron-up"} />
        </button>
        <button
          type="button"
          className="chat-ventana__accion"
          aria-label="Cerrar"
          onClick={() => chat.cerrar(conversacion.id)}
        >
          <Icon name="x-lg" />
        </button>
      </header>
      {ventana.abierta && <Conversacion conversacion={conversacion} compacta />}
    </section>
  );
}

/**
 * El chat acoplado abajo a la derecha, en todo `/admin`: el botón con lo que
 * falta leer, el panel para elegir conversación, buscar personas o crear un
 * grupo, y las pestañas de cada conversación. En `/admin/chat` se oculta: ahí
 * el chat ocupa la pantalla. Un clic fuera del chat lo minimiza todo.
 */
export function ChatDock() {
  const chat = useChat();
  const location = useLocation();
  const [panel, setPanel] = useState(false);
  const [pestana, setPestana] = useState("conversaciones");
  const zona = useRef(null);
  const algoAbierto = panel || Boolean(chat?.ventanas.some((v) => v.abierta));
  const minimizarTodo = chat?.minimizarTodo;

  // Un clic en cualquier otra parte de la pantalla minimiza el chat: el panel
  // se cierra y las conversaciones quedan en su barra, sin perderse.
  useEffect(() => {
    if (!algoAbierto) return undefined;
    function fuera(evento) {
      if (zona.current?.contains(evento.target)) return;
      setPanel(false);
      minimizarTodo?.();
    }
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [algoAbierto, minimizarTodo]);

  if (!chat || location.pathname.startsWith("/admin/chat")) return null;

  function elegir(id) {
    chat.abrir(id);
    setPanel(false);
    setPestana("conversaciones");
  }

  function pedirAvisos() {
    try {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        Notification.requestPermission();
      }
    } catch {
      /* Sin avisos del navegador: queda la campana. */
    }
  }

  return (
    <div className="chat-dock" ref={zona}>
      {chat.ventanas.map((v) => (
        <Ventana key={v.id} ventana={v} />
      ))}
      <div className="chat-dock__lanzador">
        {panel && (
          <section className="chat-panel" aria-label="Chat de la empresa">
            <header className="chat-panel__cabecera">
              <strong>Chat</strong>
              <Link
                to="/admin/chat"
                className="mz-small"
                onClick={() => setPanel(false)}
              >
                Pantalla completa
              </Link>
            </header>
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
                <ListaConversaciones onElegir={elegir} />
              )}
              {pestana === "personas" && <Directorio onElegida={elegir} />}
              {pestana === "grupos" && <Grupos onElegir={elegir} />}
            </div>
          </section>
        )}
        <button
          type="button"
          className="chat-boton"
          aria-expanded={panel}
          aria-label={
            chat.totalNoLeidos > 0
              ? `Chat: ${chat.totalNoLeidos} mensajes sin leer`
              : "Chat"
          }
          onClick={() => {
            pedirAvisos();
            setPanel((valor) => !valor);
          }}
        >
          <Icon name="chat-dots-fill" />
          <span className="chat-boton__texto">Chat</span>
          {chat.totalNoLeidos > 0 && (
            <span className="chat-contador">
              {chat.totalNoLeidos > 99 ? "99+" : chat.totalNoLeidos}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
