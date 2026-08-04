import { useEffect } from "react";
import {
  MantineProvider,
  DirectionProvider,
  useDirection,
  Container,
  Title,
  Text,
  Stack,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useHotkeys } from "react-hotkeys-hook";
import { theme } from "./theme";
import { RTL_LANGUAGES } from "./i18n";
import { useUiStore } from "./stores/useUiStore";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

const queryClient = new QueryClient();

function Shell() {
  const { t, i18n } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const setLocale = useUiStore((s) => s.setLocale);
  const { setDirection } = useDirection();

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
    <Container py="xl">
      <Stack gap="sm">
        <Title order={1}>{t("app.name")}</Title>
        <Text c="dimmed">Foundation scaffold — desktop shell, theme, and i18n are wired up.</Text>
        <Text
          component="button"
          onClick={toggleLocale}
          style={{ cursor: "pointer", textAlign: "start" }}
        >
          {locale === "en" ? "Switch to العربية" : "Switch to English"}
        </Text>
      </Stack>
    </Container>
  );
}

export default function App() {
  const locale = useUiStore((s) => s.locale);
  const dir = RTL_LANGUAGES.includes(locale) ? "rtl" : "ltr";

  return (
    <DirectionProvider initialDirection={dir} detectDirection={false}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position={dir === "rtl" ? "top-left" : "top-right"} />
        <QueryClientProvider client={queryClient}>
          <Shell />
        </QueryClientProvider>
      </MantineProvider>
    </DirectionProvider>
  );
}
