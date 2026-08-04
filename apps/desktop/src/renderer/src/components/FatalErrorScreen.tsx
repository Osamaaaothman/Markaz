import { Box, Button, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

interface FatalErrorScreenProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

// Full-page takeover for errors that make the app genuinely unusable
// (uncaught render crashes, unrecoverable startup failures) — not for
// errors the user can work around, which stay as inline state (see the
// API-connection badge in Shell). Reserving this screen for truly
// blocking errors, per explicit product direction.
export function FatalErrorScreen({ title, description, onRetry }: FatalErrorScreenProps) {
  const { t } = useTranslation();

  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "var(--mantine-color-body)",
        zIndex: 1100,
        padding: 24,
        textAlign: "center",
      }}
    >
      <IconAlertTriangle size={40} stroke={1.5} color="var(--mantine-color-red-6)" />
      <Stack gap={4} align="center" maw={420}>
        <Title order={3}>{title ?? t("error.title")}</Title>
        <Text c="dimmed" size="sm">
          {description ?? t("error.description")}
        </Text>
      </Stack>
      {onRetry && (
        <Button variant="light" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </Box>
  );
}
