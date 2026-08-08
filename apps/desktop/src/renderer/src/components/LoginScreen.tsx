import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, Box, Button, PasswordInput, Stack, TextInput, Title } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { LoginRequestSchema, type LoginRequest } from "@erp/shared";
import { ApiError } from "../lib/api";
import { useAuthStore } from "../stores/useAuthStore";

export function LoginScreen() {
  const { t } = useTranslation();
  const login = useAuthStore((s) => s.login);
  const status = useAuthStore((s) => s.status);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginRequest>({
    // Validated by the schema shared with the backend, but with our own
    // translated messages -- Zod's default messages aren't localized.
    resolver: async (data) => {
      const result = LoginRequestSchema.safeParse(data);
      if (result.success) {
        return { values: result.data, errors: {} };
      }
      const fieldErrors: Record<string, { type: string; message: string }> = {};
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]);
        fieldErrors[field] ??= { type: issue.code, message: t(`login.errors.${field}`) };
      }
      return { values: {}, errors: fieldErrors };
    },
  });

  const onSubmit = async (data: LoginRequest) => {
    setFormError(null);
    try {
      await login(data.email, data.password);
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 401
          ? t("login.invalidCredentials")
          : t("connection.error"),
      );
    }
  };

  return (
    <Box
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Stack gap="lg" w={360}>
        <Stack gap={4} align="center">
          <svg width="56" height="56" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="loginGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#5c7ac5" />
                <stop offset="100%" stopColor="#26478a" />
              </linearGradient>
            </defs>
            <rect x="4" y="4" width="92" height="92" rx="22" fill="url(#loginGrad)" />
            <path
              d="M28,72 L28,28 L50,50 L72,28 L72,72"
              fill="none"
              stroke="#ffffff"
              strokeWidth="13"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <Title order={2}>{t("app.name")}</Title>
        </Stack>

        <form onSubmit={handleSubmit(onSubmit)}>
          <Stack gap="sm">
            <TextInput
              label={t("login.email")}
              autoComplete="username"
              error={errors.email?.message}
              {...register("email")}
            />
            <PasswordInput
              label={t("login.password")}
              autoComplete="current-password"
              error={errors.password?.message}
              {...register("password")}
            />
            {formError && (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {formError}
              </Alert>
            )}
            <Button type="submit" loading={status === "authenticating"} fullWidth mt="xs">
              {t("login.submit")}
            </Button>
          </Stack>
        </form>
      </Stack>
    </Box>
  );
}
