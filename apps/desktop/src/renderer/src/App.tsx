import { useEffect, useState } from "react";
import {
  MantineProvider,
  DirectionProvider,
  useDirection,
  Container,
  Title,
  Text,
  Stack,
  Badge,
  Button,
  Group,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useHotkeys } from "react-hotkeys-hook";
import { theme } from "./theme";
import { RTL_LANGUAGES } from "./i18n";
import { useUiStore } from "./stores/useUiStore";
import { fetchHealth } from "./lib/api";
import { SplashScreen } from "./components/SplashScreen";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { ErrorBoundary } from "./components/ErrorBoundary";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

const queryClient = new QueryClient();

function Shell() {
  const { t, i18n } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const setLocale = useUiStore((s) => s.setLocale);
  const { setDirection } = useDirection();
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth, retry: 1 });

  useEffect(() => {
    setDirection(RTL_LANGUAGES.includes(locale) ? "rtl" : "ltr");
  }, [locale, setDirection]);

  // Foundation-phase shortcut registry starts here; grows into a shared
  // help dialog (press "?") as more shortcuts are added per module.
  useHotkeys("mod+k", () => {
    // Global command palette — wired up in the Foundation phase.
  });

  const toggleLocale = () => {
    const next = locale === "en" ? "ar" : "en";
    setLocale(next);
    i18n.changeLanguage(next);
  };

  return (
    <>
      <AnimatePresence>
        {health.isPending && <LoadingOverlay message={t("connection.connecting")} />}
      </AnimatePresence>

      <Container py="xl">
        <Stack gap="sm">
          <Title order={1}>{t("app.name")}</Title>
          <Text c="dimmed">{t("app.scaffoldNotice")}</Text>

          {health.isSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <Badge color="green" variant="light">
                {t("connection.connected")}
              </Badge>
            </motion.div>
          )}

          {health.isError && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <Group gap="xs">
                <Badge color="red" variant="light">
                  {t("connection.error")}
                </Badge>
                <Button size="xs" variant="subtle" onClick={() => health.refetch()}>
                  {t("common.retry")}
                </Button>
              </Group>
            </motion.div>
          )}

          <Text
            component="button"
            onClick={toggleLocale}
            style={{ cursor: "pointer", textAlign: "start" }}
          >
            {locale === "en" ? "Switch to العربية" : "Switch to English"}
          </Text>
        </Stack>
      </Container>
    </>
  );
}

function AppShell() {
  const [booted, setBooted] = useState(false);

  return (
    <>
      {!booted && <SplashScreen onFinish={() => setBooted(true)} />}
      {booted && <Shell />}
    </>
  );
}

export default function App() {
  const locale = useUiStore((s) => s.locale);
  const dir = RTL_LANGUAGES.includes(locale) ? "rtl" : "ltr";

  return (
    <DirectionProvider initialDirection={dir} detectDirection={false}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position={dir === "rtl" ? "top-left" : "top-right"} />
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AppShell />
          </QueryClientProvider>
        </ErrorBoundary>
      </MantineProvider>
    </DirectionProvider>
  );
}
