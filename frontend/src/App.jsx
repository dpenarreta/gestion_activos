import { BrowserRouter } from "react-router-dom";

import { BuscadorDeListas } from "./components/common/BuscadorDeListas/BuscadorDeListas";

import { AppearanceProvider } from "./context/AppearanceContext";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { AppRoutes } from "./routes/AppRoutes";

export function App() {
  return (
    <AppearanceProvider>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
            {/* Todo desplegable se abre con un buscador arriba. */}
            <BuscadorDeListas />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </AppearanceProvider>
  );
}
