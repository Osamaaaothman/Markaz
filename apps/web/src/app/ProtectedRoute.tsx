import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../shared/auth/auth-store";

export function ProtectedRoute(): React.JSX.Element {
  const accessToken = useAuthStore((state) => state.accessToken);
  if (accessToken === null) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
