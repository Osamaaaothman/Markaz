import { useEffect, useState } from "react";
import {
  MantineProvider,
  DirectionProvider,
  useDirection,
  AppShell,
  Container,
  Title,
  Text,
  Stack,
  Badge,
  Button,
  Group,
  Menu,
  Avatar,
  UnstyledButton,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { IconChevronDown, IconLogout } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useHotkeys } from "react-hotkeys-hook";
import { theme } from "./theme";
import { RTL_LANGUAGES } from "./i18n";
import { useUiStore } from "./stores/useUiStore";
import { useAuthStore } from "./stores/useAuthStore";
import { fetchHealth } from "./lib/api";
import { SplashScreen } from "./components/SplashScreen";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginScreen } from "./components/LoginScreen";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

const queryClient = new QueryClient();

function ConnectionBadge() {
  const { t } = useTranslation();
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth, retry: 1 });

  return (
    <AnimatePresence mode="wait">
      {health.isSuccess && (
        <motion.div
          key="connected"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <Badge color="green" variant="light">
            {t("connection.connected")}
          </Badge>
        </motion.div>
      )}
      {health.isError && (
        <motion.div
          key="error"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
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
    </AnimatePresence>
  );
}

function Header() {
  const { t, i18n } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const setLocale = useUiStore((s) => s.setLocale);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const toggleLocale = () => {
    const next = locale === "en" ? "ar" : "en";
    setLocale(next);
    i18n.changeLanguage(next);
  };

  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="xs">
        <svg width="28" height="28" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#5c7ac5" />
              <stop offset="100%" stopColor="#26478a" />
            </linearGradient>
          </defs>
          <rect x="4" y="4" width="92" height="92" rx="22" fill="url(#headerGrad)" />
          <path
            d="M28,72 L28,28 L50,50 L72,28 L72,72"
            fill="none"
            stroke="#ffffff"
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <Text fw={700}>{t("app.name")}</Text>
      </Group>

      <Group gap="md">
        <ConnectionBadge />
        <Text
          component="button"
          onClick={toggleLocale}
          style={{ cursor: "pointer", background: "none", border: "none" }}
        >
          {locale === "en" ? "Switch to العربية" : "Switch to English"}
        </Text>
        <Menu shadow="md" width={180} position="bottom-end">
          <Menu.Target>
            <UnstyledButton>
              <Group gap={6}>
                <Avatar size="sm" radius="xl" color="brand">
                  {user?.name.charAt(0).toUpperCase()}
                </Avatar>
                <IconChevronDown size={14} />
              </Group>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconLogout size={14} />} onClick={() => logout()}>
              {t("nav.logout")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}

function Dashboard() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  return (
    <Container py="xl">
      <Stack gap="sm">
        <Title order={2}>{t("nav.welcome", { name: user?.name })}</Title>
        <Text c="dimmed">{t("app.scaffoldNotice")}</Text>
      </Stack>
    </Container>
  );
}

function AuthenticatedLayout() {
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Header />
      </AppShell.Header>
      <AppShell.Main>
        <Dashboard />
      </AppShell.Main>
    </AppShell>
  );
}

function AuthGate() {
  const { setDirection } = useDirection();
  const locale = useUiStore((s) => s.locale);
  const status = useAuthStore((s) => s.status);
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    setDirection(RTL_LANGUAGES.includes(locale) ? "rtl" : "ltr");
  }, [locale, setDirection]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Foundation-phase shortcut registry starts here; grows into a shared
  // help dialog (press "?") as more shortcuts are added per module.
  useHotkeys("mod+k", () => {
    // Global command palette — wired up in the Foundation phase.
  });

  if (status === "idle") {
    return <LoadingOverlay />;
  }
  if (status === "unauthenticated" || status === "authenticating") {
    return <LoginScreen />;
  }
  return <AuthenticatedLayout />;
}

function AppRoot() {
  const [booted, setBooted] = useState(false);

  return (
    <>
      {!booted && <SplashScreen onFinish={() => setBooted(true)} />}
      {booted && <AuthGate />}
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
            <AppRoot />
          </QueryClientProvider>
        </ErrorBoundary>
      </MantineProvider>
    </DirectionProvider>
  );
}
