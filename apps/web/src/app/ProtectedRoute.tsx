import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../shared/auth/auth-store";
import { useCurrentUser } from "../shared/auth/use-current-user";
import { PageLoader } from "../shared/ui/Loading";

export function ProtectedRoute(): React.JSX.Element {
  const accessToken = useAuthStore((state) => state.accessToken);
  const { isPending } = useCurrentUser();
  if (accessToken === null) {
    return <Navigate to="/login" replace />;
  }
  // The shell needs the profile (permissions, company) to draw the sidebar: until it arrives the whole screen shows the logo.
  if (isPending) {
    return <PageLoader />;
  }
  return <Outlet />;
}
