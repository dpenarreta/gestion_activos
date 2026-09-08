import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/context/AuthContext";
import { Login } from "../src/pages/Login/Login";

vi.mock("../src/api/client", () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
  getAccessToken: vi.fn(() => null),
  getRefreshToken: vi.fn(() => null),
  setTokens: vi.fn(),
}));

describe("Login", () => {
  it("pide un identificador (usuario o correo), no un username específico", () => {
    render(
      <AuthProvider>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </AuthProvider>
    );
    expect(screen.getByLabelText(/usuario o correo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/usuario o correo/i)).toBeRequired();
    expect(screen.getByLabelText(/contraseña/i)).toBeRequired();
  });
});
