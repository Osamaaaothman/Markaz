import type { LoginRequest, LoginResponse } from "@erp/shared";

// Defaults to the local dev API. Becomes a configurable per-deployment
// setting (LAN server address) in the Foundation-phase settings module.
const API_BASE_URL = "http://localhost:3000";

interface HealthResponse {
  status: string;
  timestamp: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.message ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(parseOrThrow<T>);
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return res.json();
}

export function login(payload: LoginRequest): Promise<LoginResponse> {
  return postJson<LoginResponse>("/auth/login", payload);
}

export function refreshTokens(refreshToken: string): Promise<LoginResponse> {
  return postJson<LoginResponse>("/auth/refresh", { refreshToken });
}

export function logout(refreshToken: string): Promise<void> {
  return postJson<void>("/auth/logout", { refreshToken });
}
