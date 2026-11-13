import { render } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import { useAbrirAlTocarPush } from "../src/notificaciones/useAbrirAlTocarPush";

const mockRouter = { push: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));

function respuesta({ id = 42, empresa = null, identifier = "push-1" } = {}) {
  return {
    notification: {
      request: { identifier, content: { data: { notificacion_id: id, modulo: "soporte", empresa } } },
    },
  };
}

function Prueba({ activo = true }) {
  useAbrirAlTocarPush(activo);
  return null;
}

let oyente;
beforeEach(() => {
  jest.clearAllMocks();
  oyente = null;
  Notifications.addNotificationResponseReceivedListener.mockImplementation((fn) => {
    oyente = fn;
    return { remove: jest.fn() };
  });
  Notifications.getLastNotificationResponse.mockReturnValue(null);
});

describe("tocar un push", () => {
  it("en arranque en frío abre el detalle una sola vez, aunque el listener repita la respuesta", async () => {
    const tocada = respuesta({ empresa: 3 });
    Notifications.getLastNotificationResponse.mockReturnValue(tocada);

    await render(<Prueba />);
    oyente(tocada);

    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/notificacion/[id]",
      params: { id: "42", empresa: "3" },
    });
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it("con la app abierta, cada push nuevo abre su detalle", async () => {
    await render(<Prueba />);
    oyente(respuesta({ id: 1, identifier: "a" }));
    oyente(respuesta({ id: 2, identifier: "b" }));

    expect(mockRouter.push).toHaveBeenNthCalledWith(1, { pathname: "/notificacion/[id]", params: { id: "1" } });
    expect(mockRouter.push).toHaveBeenNthCalledWith(2, { pathname: "/notificacion/[id]", params: { id: "2" } });
  });

  it("mientras falta algo en la web (AccionPendiente) no la consume; la abre al terminar", async () => {
    Notifications.getLastNotificationResponse.mockReturnValue(respuesta());

    const { rerender } = await render(<Prueba activo={false} />);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(Notifications.clearLastNotificationResponse).not.toHaveBeenCalled();

    await rerender(<Prueba activo />);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it("ignora un push sin notificacion_id válido", async () => {
    Notifications.getLastNotificationResponse.mockReturnValue(respuesta({ id: "../x" }));
    await render(<Prueba />);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
