// Defaults to the local dev API. Becomes a configurable per-deployment
// setting (LAN server address) in the Foundation-phase settings module.
const API_BASE_URL = "http://localhost:3000";

interface HealthResponse {
  status: string;
  timestamp: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return res.json();
}
