import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Password } from "primereact/password";
import { InputText } from "primereact/inputtext";
import { z } from "zod";
import { useLogin } from "./use-login";

// Messages are translation-key suffixes, not literal text (looked up via
// t(`validation.${message}`) below) — this sidesteps depending on Zod's
// internal issue "code"/"type" naming, which changes across major versions.
const loginSchema = z.object({
  email: z.string().min(1, "required").email("invalidEmail"),
  password: z.string().min(1, "required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useLogin();

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
    <div className="erp-auth-page">
      <form className="erp-auth-card" onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="erp-auth-card__brand">
          <span className="erp-sidebar__brand-mark">م</span>
        </div>
        <h1 className="erp-auth-card__title">{t("auth.login.title")}</h1>
        <p className="erp-auth-card__subtitle">{t("auth.login.subtitle")}</p>

        <div className="erp-field">
          <label htmlFor="email">{t("auth.login.email")}</label>
          <InputText id="email" autoComplete="username" invalid={Boolean(errors.email)} {...register("email")} />
          {errors.email ? (
            <span className="erp-field__error">{t(`validation.${errors.email.message}`)}</span>
          ) : null}
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
          {errors.password ? (
            <span className="erp-field__error">{t(`validation.${errors.password.message}`)}</span>
          ) : null}
        </div>

        {login.isError ? (
          <p className="erp-auth-card__error" role="alert">
            {isInvalidCredentials ? t("auth.login.invalidCredentials") : t("auth.login.genericError")}
          </p>
        ) : null}

        <Button
          type="submit"
          label={t("auth.login.submit")}
          loading={login.isPending}
          className="erp-auth-card__submit"
        />
      </form>
    </div>
  );
}
