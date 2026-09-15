import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "../../shared/ui/Button";
import { Card, CardContent, CardHeader } from "../../shared/ui/Card";
import { Field } from "../../shared/ui/Field";
import { Input } from "../../shared/ui/Input";
import { PasswordInput } from "../../shared/ui/PasswordInput";
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
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center gap-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-lg bg-primary font-serif text-lg font-medium text-primary-foreground">
            م
          </span>
          <div>
            <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">{t("auth.login.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("auth.login.subtitle")}</p>
          </div>
        </CardHeader>
        <CardContent className="pb-6">
          <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
            <Field
              htmlFor="email"
              label={t("auth.login.email")}
              error={errors.email ? t(`validation.${errors.email.message}`) : undefined}
            >
              <Input
                id="email"
                autoComplete="username"
                aria-invalid={Boolean(errors.email)}
                {...register("email")}
              />
            </Field>

            <Field
              htmlFor="password"
              label={t("auth.login.password")}
              error={errors.password ? t(`validation.${errors.password.message}`) : undefined}
            >
              <Controller
                control={control}
                name="password"
                render={({ field }) => (
                  <PasswordInput
                    id="password"
                    autoComplete="current-password"
                    aria-invalid={Boolean(errors.password)}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </Field>

            {login.isError ? (
              <p className="text-center text-sm font-medium text-destructive" role="alert">
                {isInvalidCredentials ? t("auth.login.invalidCredentials") : t("auth.login.genericError")}
              </p>
            ) : null}

            <Button type="submit" size="lg" loading={login.isPending} className="mt-1 w-full">
              {t("auth.login.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
