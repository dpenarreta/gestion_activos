import { BrowserRouter } from "react-router-dom";

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
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </AppearanceProvider>
  );
}
