import type { Action } from "@erp/bots";
import type { BotContext, BotFeature, BotUserContext, FeatureMessage, Intent } from "../application/bot-context.js";
import { BotNotice } from "../application/bot-runtime.js";
import { ALERT_TYPES } from "./alert-types.js";
import { backToMenu, button, card, dir, openInErp, rows, type BotServices } from "./feature-kit.js";

// Main menu, help, account linking and personal settings — always on, whatever features the
// connection has enabled.

async function menuMessage(ctx: BotUserContext): Promise<FeatureMessage> {
  const items: Action<Intent>[] = [];
  const offer = async (feature: Parameters<BotUserContext["featureEnabled"]>[0], action: string, resource: string, item: Action<Intent>) => {
    if (ctx.featureEnabled(feature) && (await ctx.can(action, resource))) items.push(item);
  };
  await offer("approvals", "approve", "purchase_order", button(ctx.t("menu.approvals"), { f: "approvals", a: "list" }, "primary", "approval"));
  await offer("lookups", "read", "party", button(ctx.t("menu.customers"), { f: "lookups", a: "searchCustomers", form: "search" }, "secondary", "customer"));
  await offer("lookups", "read", "item", button(ctx.t("menu.items"), { f: "lookups", a: "searchItems", form: "search" }, "secondary", "stock"));
  await offer("lookups", "read", "sales_invoice", button(ctx.t("menu.invoices"), { f: "lookups", a: "searchInvoices", form: "search" }, "secondary", "invoice"));
  await offer("lookups", "read", "balance_sheet", button(ctx.t("menu.cash"), { f: "lookups", a: "cash" }, "secondary", "cash"));
  if (ctx.featureEnabled("reports")) items.push(button(ctx.t("menu.dailyReport"), { f: "reports", a: "daily" }, "secondary", "report"));
  items.push(button(ctx.t("menu.settings"), { f: "menu", a: "settings" }, "secondary", "settings"));

  const grid: Action<Intent>[][] = [];
  for (let i = 0; i < items.length; i += 2) grid.push(items.slice(i, i + 2));
  return card(
    ctx,
    [
      { type: "header", tone: "brand", icon: "menu", title: ctx.t("menu.title", { company: ctx.connection.companyName }) },
      { type: "text", text: ctx.t("menu.intro") },
    ],
    rows(...grid, openInErp(ctx, "/")),
  );
}

function helpMessage(ctx: BotUserContext, linked: boolean): FeatureMessage {
  return card(
    ctx,
    [
      { type: "header", tone: "info", icon: "menu", title: ctx.t("help.title") },
      { type: "text", text: linked ? ctx.t("help.linked") : ctx.t("help.notLinked") },
      {
        type: "list",
        items: ["menu", "approvals", "customer", "item", "invoice", "cash", "report", "attach", "settings", "unlink"].map((name) => ({ title: `/${name}`, detail: ctx.t(`commands.${name}`) })),
      },
    ],
    linked ? rows([backToMenu(ctx)]) : [],
  );
}

function settingsMessage(ctx: BotUserContext): FeatureMessage {
  const user = ctx.user;
  const quiet = user.quietHoursStart && user.quietHoursEnd ? `${user.quietHoursStart}–${user.quietHoursEnd}` : ctx.t("settings.quietOff");
  const alertButtons = ALERT_TYPES.map((type) => {
    const on = !user.disabledAlerts.includes(type);
    return button(`${on ? "🔔" : "🔕"} ${ctx.t(`alerts.types.${type}`)}`, { f: "menu", a: "toggleAlert", p: { type } }, on ? "success" : "secondary");
  });
  return card(
    ctx,
    [
      { type: "header", tone: "neutral", icon: "settings", title: ctx.t("settings.title") },
      {
        type: "fields",
        items: [
          { label: ctx.t("settings.language"), value: ctx.language === "ar" ? "العربية" : "English" },
          { label: ctx.t("settings.quietHours"), value: quiet },
        ],
      },
      { type: "text", text: ctx.t("settings.alertsHint"), emphasis: "muted" },
    ],
    rows(
      [
        button(ctx.language === "ar" ? "English" : "العربية", { f: "menu", a: "setLanguage", p: { lang: ctx.language === "ar" ? "en" : "ar" } }, "secondary", "settings"),
        button(user.quietHoursStart ? ctx.t("settings.quietDisable") : ctx.t("settings.quietEnable"), { f: "menu", a: "toggleQuiet" }, "secondary", "calendar"),
      ],
      alertButtons.slice(0, 2),
      alertButtons.slice(2),
      [backToMenu(ctx)],
    ),
  );
}

async function linkWithCode(services: BotServices, ctx: BotContext, code: string): Promise<void> {
  const chat = await ctx.adapter.openDirectChat(ctx.event.sender.id, ctx.secrets).catch(() => ctx.event.chat);
  const outcome = await services.links.consume(ctx.connection.id, code, ctx.event.sender, chat.chatId, ctx.correlationId);
  if (outcome.status === "invalid") throw new BotNotice("link.invalid");
  if (outcome.status === "already_linked_other") throw new BotNotice("link.otherAccount", {}, "danger");
  // Re-read as the newly linked user so the menu reflects their permissions and language.
  const runtime = services.runtime;
  if (!runtime) return;
  const linkedCtx = await runtime.userContext(
    ctx.connection,
    { linkId: "", userId: outcome.userId, language: outcome.language, privateChatId: chat.chatId, quietHoursStart: null, quietHoursEnd: null, disabledAlerts: [] },
    ctx.correlationId,
  );
  const message = await menuMessage(linkedCtx);
  const welcome: FeatureMessage = {
    direction: dir(linkedCtx),
    blocks: [{ type: "header", tone: "success", icon: "check", title: linkedCtx.t("link.success") }, ...message.blocks.slice(1)],
    ...(message.actions ? { actions: message.actions } : {}),
  };
  const rendered = await runtime.materialize(welcome, ctx.connection, outcome.userId);
  await ctx.adapter.reply(ctx.event, rendered, ctx.secrets, "replace");
}

function isLinked(ctx: BotUserContext): boolean {
  return ctx.user.userId !== "";
}

export function createMenuFeature(services: BotServices): BotFeature {
  return {
    key: "menu",
    commands: {
      start: async (ctx, args) => {
        if (args.trim()) return linkWithCode(services, ctx, args);
        if (!isLinked(ctx)) return ctx.reply(helpMessage(ctx, false), "new");
        return ctx.reply(await menuMessage(ctx), "new");
      },
      link: async (ctx, args) => {
        if (!args.trim()) throw new BotNotice("link.howTo", {}, "info");
        return linkWithCode(services, ctx, args);
      },
      menu: async (ctx) => ctx.reply(await menuMessage(ctx), "new"),
      help: async (ctx) => ctx.reply(helpMessage(ctx, isLinked(ctx)), "new"),
      settings: async (ctx) => ctx.reply(settingsMessage(ctx), "new"),
      chatid: async (ctx) =>
        ctx.reply(
          card(ctx, [
            { type: "header", tone: "info", icon: "settings", title: ctx.t("chatid.title") },
            { type: "fields", items: [{ label: ctx.t("chatid.label"), value: ctx.event.chat.chatId }] },
            { type: "text", text: ctx.t("chatid.hint"), emphasis: "muted" },
          ]),
          "new",
        ),
      unlink: async (ctx) => {
        await services.links.unlinkFromChat(ctx.connection.id, ctx.event.sender.id, ctx.correlationId);
        await ctx.reply(card(ctx, [{ type: "header", tone: "neutral", icon: "link", title: ctx.t("link.unlinked") }]), "new");
      },
    },
    actions: {
      open: async (ctx) => ctx.reply(await menuMessage(ctx)),
      settings: async (ctx) => ctx.reply(settingsMessage(ctx)),
      setLanguage: async (ctx, p) => {
        const lang = p["lang"] === "ar" ? "ar" : "en";
        await services.prisma.botIdentityLink.update({ where: { id: ctx.user.linkId }, data: { language: lang } });
        const runtime = services.runtime;
        if (!runtime) return;
        const fresh = await runtime.userContext(ctx.connection, { ...ctx.user, language: lang }, ctx.correlationId);
        await ctx.reply(settingsMessage(fresh));
      },
      toggleQuiet: async (ctx) => {
        const on = ctx.user.quietHoursStart !== null;
        const next = on ? { quietHoursStart: null, quietHoursEnd: null } : { quietHoursStart: "22:00", quietHoursEnd: "07:00" };
        await services.prisma.botIdentityLink.update({ where: { id: ctx.user.linkId }, data: next });
        await ctx.reply(settingsMessage({ ...ctx, user: { ...ctx.user, ...next } }));
      },
      toggleAlert: async (ctx, p) => {
        const type = p["type"] ?? "";
        if (!(ALERT_TYPES as ReadonlyArray<string>).includes(type)) return;
        const disabled = ctx.user.disabledAlerts.includes(type) ? ctx.user.disabledAlerts.filter((t) => t !== type) : [...ctx.user.disabledAlerts, type];
        await services.prisma.botIdentityLink.update({ where: { id: ctx.user.linkId }, data: { disabledAlerts: disabled } });
        await ctx.reply(settingsMessage({ ...ctx, user: { ...ctx.user, disabledAlerts: disabled } }));
      },
    },
  };
}
