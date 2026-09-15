import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Languages, LogOut, Menu as MenuIcon, Moon, Sun } from "lucide-react";
import { useThemeStore } from "../../shared/theme/theme-store";
import { useAuthStore } from "../../shared/auth/auth-store";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { Avatar, AvatarFallback } from "../../shared/ui/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../shared/ui/DropdownMenu";
import { useLayoutStore } from "./layout-store";

function initialsOf(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

const iconButtonClass =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/20";

export function Topbar(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const mode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const clearAuth = useAuthStore((state) => state.clear);
  const openMobileSidebar = useLayoutStore((state) => state.openMobileSidebar);
  const { data: currentUser } = useCurrentUser();

  const switchLanguage = (): void => {
    void i18n.changeLanguage(i18n.language === "ar" ? "en" : "ar");
  };

  const logout = (): void => {
    clearAuth();
    void navigate("/login", { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
      <button
        type="button"
        className={`${iconButtonClass} lg:hidden`}
        onClick={openMobileSidebar}
        aria-label={t("actions.openMenu")}
      >
        <MenuIcon className="size-5" />
      </button>

      <div className="flex-1" />

      <button
        type="button"
        className={iconButtonClass}
        onClick={switchLanguage}
        aria-label={t("language.switch")}
        title={t("language.switch")}
      >
        <Languages className="size-5" />
      </button>

      <button
        type="button"
        className={iconButtonClass}
        onClick={toggleTheme}
        aria-label={mode === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
        title={mode === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
      >
        {mode === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="ms-1 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
            aria-label={currentUser?.email ?? ""}
          >
            <Avatar>
              <AvatarFallback>{currentUser ? initialsOf(currentUser.email) : "…"}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="truncate">{currentUser?.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={logout}>
            <LogOut className="size-4" />
            {t("actions.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
