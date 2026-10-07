import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Password } from "primereact/password";
import { InputText } from "primereact/inputtext";
import { z } from "zod";
import { useThemeStore } from "../../shared/theme/theme-store";
import { Logo, LogoMark } from "../../shared/ui/Logo";
import { useLogin } from "./use-login";

// Messages are translation-key suffixes, not literal text (looked up via
// t(`validation.${message}`) below) — this sidesteps depending on Zod's
// internal issue "code"/"type" naming, which changes across major versions.
const loginSchema = z.object({
  email: z.string().min(1, "required").email("invalidEmail"),
  password: z.string().min(1, "required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const POINTS = [
  { key: "a", icon: "pi pi-shield" },
  { key: "b", icon: "pi pi-language" },
  { key: "c", icon: "pi pi-file-export" },
] as const;

export function LoginPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const login = useLogin();
  const mode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const isArabic = i18n.language === "ar";

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = handleSubmit((values) => {
    login.mutate(values, { onSuccess: () => void navigate("/", { replace: true }) });
  });

  const isInvalidCredentials = login.error instanceof AxiosError && login.error.response?.status === 401;

  return (
    <div className="mk-auth">
      <aside className="mk-auth__brand">
        <span className="mk-auth__orb mk-auth__orb--a" aria-hidden="true" />
        <span className="mk-auth__orb mk-auth__orb--b" aria-hidden="true" />
        <span className="mk-auth__grid" aria-hidden="true" />

        <div className="mk-auth__brand-top">
          <Logo variant="full" size={56} animate name={t("app.name")} tagline={t("app.tagline")} />
        </div>

        <div className="mk-auth__brand-mid">
          <h2 className="mk-auth__hero">
            {t("authHero.titleA")} <em>{t("authHero.titleB")}</em>
          </h2>
          <p className="mk-auth__lead">{t("authHero.lead")}</p>
          <ul className="mk-auth__points">
            {POINTS.map((point, index) => (
              <li key={point.key} style={{ "--i": index } as React.CSSProperties}>
                <i className={point.icon} aria-hidden="true" />
                <span>{t(`authHero.points.${point.key}`)}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mk-auth__brand-foot">{t("authHero.footer", { year: new Date().getFullYear() })}</p>
      </aside>

      <main className="mk-auth__panel">
        <div className="mk-auth__tools">
          <button type="button" className="erp-topbar__lang" onClick={() => void i18n.changeLanguage(isArabic ? "en" : "ar")} aria-label={t("language.switch")}>
            {isArabic ? "EN" : "عربي"}
          </button>
          <button
            type="button"
            className="erp-topbar__icon-button"
            onClick={toggleTheme}
            aria-label={mode === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
          >
            <i className={mode === "dark" ? "pi pi-sun" : "pi pi-moon"} />
          </button>
        </div>

        <form className="mk-auth__card" onSubmit={(e) => void onSubmit(e)} noValidate>
          <LogoMark size={44} />
          <div>
            <h1 className="erp-auth-card__title">{t("auth.login.title")}</h1>
            <p className="erp-auth-card__subtitle">{t("auth.login.subtitle")}</p>
          </div>

          <div className="erp-field">
            <label htmlFor="email">{t("auth.login.email")}</label>
            <InputText id="email" autoComplete="username" invalid={Boolean(errors.email)} {...register("email")} />
            {errors.email ? <span className="erp-field__error">{t(`validation.${errors.email.message}`)}</span> : null}
          </div>

          <div className="erp-field">
            <label htmlFor="password">{t("auth.login.password")}</label>
            <Controller
              control={control}
              name="password"
              render={({ field }) => (
                <Password
                  inputId="password"
                  feedback={false}
                  toggleMask
                  autoComplete="current-password"
                  invalid={Boolean(errors.password)}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            {errors.password ? <span className="erp-field__error">{t(`validation.${errors.password.message}`)}</span> : null}
          </div>

          {login.isError ? (
            <p className="erp-auth-card__error" role="alert">
              {isInvalidCredentials ? t("auth.login.invalidCredentials") : t("auth.login.genericError")}
            </p>
          ) : null}

          <Button type="submit" label={t("auth.login.submit")} loading={login.isPending} className="erp-auth-card__submit" />
        </form>
      </main>
    </div>
  );
}
