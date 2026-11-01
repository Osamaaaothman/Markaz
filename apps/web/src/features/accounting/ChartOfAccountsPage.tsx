import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { SelectButton } from "primereact/selectbutton";
import { Tag } from "primereact/tag";
import { TreeTable } from "primereact/treetable";
import type { TreeNode } from "primereact/treenode";
import { useCurrentUser } from "../../shared/auth/use-current-user";
import { usePermissions } from "../../shared/auth/use-permissions";
import { localizedName } from "../../shared/lib/localized-name";
import { formatMoney } from "../../shared/lib/money";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { CopyId } from "../../shared/ui/CopyId";
import { CreatedDialog, type CreatedInfo } from "../../shared/ui/CreatedDialog";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { partyKindIcon } from "../parties/party-kind";
import { inferFromCode, suggestNextCode } from "./account-code";
import {
  ancestorIds,
  buildAccountTree,
  expandedKeysForLevel,
  filterAccountTree,
  toggleExpandedKey,
  descendantIds,
  type AccountNodeData,
  type ExpandedKeys,
  type LevelChoice,
} from "./account-tree";
import { ColorSwatches } from "./ColorSwatches";
import { MoveAccountDialog } from "./MoveAccountDialog";
import { PartyPicker } from "./PartyPicker";
import { useAccountBalances, type AccountBalance } from "./use-account-balances";
import {
  useChartOfAccounts,
  useCreateAccount,
  useUpdateAccount,
  type ChartOfAccountEntry,
} from "./use-chart-of-accounts";

type ChartNodeData = AccountNodeData<ChartOfAccountEntry>;

// ─── Add-account dialog ───────────────────────────────────────────────────────

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

// PrimeReact's Dropdown returns the whole option object when an option's value is null,
// so "no parent" is a sentinel string that is mapped back to null at the form boundary.
const NO_PARENT = "__none__";

// Messages are translation-key suffixes under `validation.` (see LoginPage's schema).
// Letters and digits: real-world codes such as supplier accounts look like "2110601A0001".
const addAccountSchema = z.object({
  code: z.string().min(1, "required").max(20, "codeFormat").regex(/^[A-Za-z0-9]+$/, "codeFormat"),
  name: z.string().min(1, "required"),
  nameAr: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  isPostable: z.boolean(),
  parentId: z.string().nullable(),
  partyId: z.string().nullable(),
  color: z.string().nullable(),
});
type AddAccountValues = z.infer<typeof addAccountSchema>;

function AddAccountDialog({
  visible,
  onHide,
  accounts,
  onCreated,
}: {
  visible: boolean;
  onHide: () => void;
  accounts: ChartOfAccountEntry[];
  // Called with the saved account and what to show about it, before the dialog closes.
  onCreated: (account: ChartOfAccountEntry, info: CreatedInfo) => void;
}) {
  const { t, i18n } = useTranslation();
  const { can } = usePermissions();
  const createAccount = useCreateAccount();
  // Once the person has picked a parent (or "no parent") by hand, typing a code must never change it: the code is
  // only a suggestion. Typing a code decides the parent only while no parent has been chosen yet.
  const parentChosen = useRef(false);
  // The code and the parent/type keep each other in step: choosing a parent (or the suggest
  // button) fills the code in; typing a code sets the parent and type from it.

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<AddAccountValues>({
    resolver: zodResolver(addAccountSchema),
    defaultValues: {
      code: "",
      name: "",
      nameAr: "",
      type: "ASSET",
      isPostable: true,
      parentId: null,
      partyId: null,
      color: null,
    },
  });

  const onHideAndReset = () => {
    parentChosen.current = false;
    reset();
    createAccount.reset();
    onHide();
  };

  // Fill the code from the parent and type (clears it when nothing can be suggested).
  const fillSuggestedCode = (parentId: string | null, type: string): void => {
    setValue("code", suggestNextCode(accounts, parentId, type) ?? "", { shouldValidate: false });
  };

  // The code was typed: let it decide the parent and type.
  const followTypedCode = (code: string): void => {
    if (parentChosen.current) return;
    const inferred = inferFromCode(accounts, code);
    if (inferred.kind === "parent") {
      setValue("parentId", inferred.parent.id);
      setValue("type", inferred.parent.type as AddAccountValues["type"]);
      setValue("color", null);
    } else if (inferred.kind === "root") {
      setValue("parentId", null);
      if (inferred.type) setValue("type", inferred.type as AddAccountValues["type"]);
    }
  };

  const onSubmit = handleSubmit((values) => {
    createAccount.mutate(
      {
        code: values.code,
        name: values.name,
        ...(values.nameAr.trim() ? { nameAr: values.nameAr.trim() } : {}),
        type: values.type,
        isPostable: values.isPostable,
        parentId: values.parentId,
        ...(values.partyId ? { partyId: values.partyId } : {}),
        // Only a top-level account has a colour (its branch is drawn in it).
        ...(values.parentId === null && values.color ? { color: values.color } : {}),
      },
      {
        onSuccess: (response) => {
          const account = response.data;
          const parent = accounts.find((a) => a.id === account.parentId);
          onCreated(account, {
            title: t("accounting.chartOfAccounts.addAccount"),
            headline: account.code,
            rows: [
              { label: t("created.name"), value: account.name },
              { label: t("accounting.chartOfAccounts.nameAr"), value: account.nameAr ?? "" },
              { label: t("created.type"), value: t(`accounting.chartOfAccounts.type${account.type.charAt(0) + account.type.slice(1).toLowerCase()}`) },
              { label: t("created.parent"), value: parent ? `${parent.code} — ${localizedName(parent, i18n.language)}` : t("created.topLevel") },
              { label: t("created.postable"), value: account.isPostable ? t("created.yes") : t("created.no") },
              { label: t("accounting.chartOfAccounts.id"), value: account.ref, ltr: true },
            ],
          });
          onHideAndReset();
        },
      },
    );
  });

  const typeOptions = ACCOUNT_TYPES.map((t_) => ({
    label: t(`accounting.chartOfAccounts.type${t_.charAt(0) + t_.slice(1).toLowerCase()}`),
    value: t_,
  }));

  const selectedType = useWatch({ control, name: "type" });
  const selectedParentId = useWatch({ control, name: "parentId" });
  const typedCode = useWatch({ control, name: "code" });
  const typedHint = useMemo(() => inferFromCode(accounts, typedCode), [accounts, typedCode]);
  // With a parent chosen on purpose, the only thing worth saying about the code is that it is already used.
  const codeHint = selectedParentId !== null && typedHint.kind !== "duplicate" ? ({ kind: "empty" } as const) : typedHint;
  const noRoomForCode =
    !typedCode.trim() && selectedParentId !== null && suggestNextCode(accounts, selectedParentId, selectedType) === null;

  // A parent is a group, not a postable account: only leaf accounts are postable
  // (docs/05-ACCOUNTING-INTEGRITY-RULES.md §4). Picking one sets the type to the parent's
  // (a child has its parent's type — docs/04-DATA-MODEL-RULES.md account hierarchy rule).
  const parentOptions = [
    { label: t("accounting.chartOfAccounts.noParent"), value: NO_PARENT },
    ...accounts
      .filter((a) => !a.isPostable)
      .map((a) => ({ label: `${a.code} — ${localizedName(a, i18n.language)}`, value: a.id })),
  ];

  const isConflict =
    createAccount.isError &&
    (createAccount.error as { response?: { status?: number } })?.response?.status === 409;

  return (
    <Dialog
      header={t("accounting.chartOfAccounts.addAccount")}
      visible={visible}
      onHide={onHideAndReset}
      className="erp-dialog"
      modal
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        {/* Code */}
        <div className="erp-field">
          <label htmlFor="acctCode">{t("accounting.chartOfAccounts.code")}</label>
          <div className="erp-code-input">
            <InputText
              id="acctCode"
              dir="ltr"
              {...register("code", {
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => followTypedCode(e.target.value),
              })}
              className={errors.code || codeHint.kind === "duplicate" ? "p-invalid" : ""}
              placeholder={t("accounting.chartOfAccounts.codePlaceholder")}
              autoComplete="off"
            />
            <Button
              type="button"
              icon="pi pi-sync"
              rounded
              text
              severity="secondary"
              title={t("accounting.chartOfAccounts.suggestCode")}
              aria-label={t("accounting.chartOfAccounts.suggestCode")}
              onClick={() => fillSuggestedCode(getValues("parentId"), getValues("type"))}
            />
          </div>
          {errors.code ? (
            <small className="erp-field__error">{t(`validation.${errors.code.message}`)}</small>
          ) : codeHint.kind === "duplicate" ? (
            <small className="erp-field__error">
              {t("accounting.chartOfAccounts.codeHint.duplicate", {
                code: codeHint.account.code,
                name: localizedName(codeHint.account, i18n.language),
              })}
            </small>
          ) : codeHint.kind === "postableParent" ? (
            <small className="erp-field__error">
              {t("accounting.chartOfAccounts.codeHint.postableParent", { code: codeHint.parent.code })}
            </small>
          ) : codeHint.kind === "noParent" ? (
            <small className="erp-field__error">{t("accounting.chartOfAccounts.codeHint.noParent")}</small>
          ) : codeHint.kind === "parent" ? (
            <small className="erp-field__hint">
              {t("accounting.chartOfAccounts.codeHint.parent", {
                code: codeHint.parent.code,
                name: localizedName(codeHint.parent, i18n.language),
              })}
            </small>
          ) : codeHint.kind === "root" ? (
            <small className="erp-field__hint">{t("accounting.chartOfAccounts.codeHint.root")}</small>
          ) : (
            <small className={noRoomForCode ? "erp-field__error" : "erp-field__hint"}>
              {t(noRoomForCode ? "accounting.chartOfAccounts.codeHint.full" : "accounting.chartOfAccounts.codeHint.empty")}
            </small>
          )}
        </div>

        {/* Name (English) */}
        <div className="erp-field">
          <label htmlFor="acctName">{t("accounting.chartOfAccounts.nameEn")}</label>
          <InputText
            id="acctName"
            {...register("name")}
            className={errors.name ? "p-invalid" : ""}
          />
          {errors.name ? (
            <small className="erp-field__error">{t("validation.required")}</small>
          ) : null}
        </div>

        {/* Name (Arabic) — optional; the English name is shown wherever it is empty. */}
        <div className="erp-field">
          <label htmlFor="acctNameAr">{t("accounting.chartOfAccounts.nameAr")}</label>
          <InputText id="acctNameAr" dir="rtl" {...register("nameAr")} />
        </div>

        {/* Type */}
        <div className="erp-field">
          <label htmlFor="acctType">{t("accounting.chartOfAccounts.type")}</label>
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <Dropdown
                inputId="acctType"
                value={field.value}
                // A child has its parent's type, so the type is only chosen for a top-level account.
                disabled={selectedParentId !== null}
                onChange={(e) => {
                  field.onChange(e.value);
                  parentChosen.current = false;
                  setValue("parentId", null);
                  setValue("code", "");
                }}
                options={typeOptions}
              />
            )}
          />
        </div>

        {/* Parent account */}
        <div className="erp-field">
          <label htmlFor="acctParent">{t("accounting.chartOfAccounts.parentAccount")}</label>
          <Controller
            control={control}
            name="parentId"
            render={({ field }) => (
              <Dropdown
                inputId="acctParent"
                value={field.value ?? NO_PARENT}
                onChange={(e) => {
                  const parentId = e.value === NO_PARENT ? null : (e.value as string);
                  const parent = parentId === null ? null : accounts.find((a) => a.id === parentId);
                  parentChosen.current = true;
                  field.onChange(parentId);
                  if (parent) {
                    setValue("type", parent.type as AddAccountValues["type"]);
                    setValue("color", null);
                  }
                  fillSuggestedCode(parentId, parent?.type ?? getValues("type"));
                }}
                options={parentOptions}
                filter
              />
            )}
          />
        </div>

        {/* isPostable toggle */}
        <div className="erp-field" style={{ flexDirection: "row", alignItems: "center", gap: "0.75rem" }}>
          <Controller
            control={control}
            name="isPostable"
            render={({ field }) => (
              <InputSwitch
                inputId="acctPostable"
                checked={field.value}
                onChange={(e) => field.onChange(e.value)}
              />
            )}
          />
          <label htmlFor="acctPostable" style={{ marginBlockEnd: 0 }}>
            {t("accounting.chartOfAccounts.isPostable")}
          </label>
        </div>

        {/* Linked party — offered only to users who may read parties. */}
        {can("party:read") ? (
          <div className="erp-field">
            <label htmlFor="acctParty">{t("accounting.chartOfAccounts.party")}</label>
            <Controller
              control={control}
              name="partyId"
              render={({ field }) => (
                <PartyPicker
                  inputId="acctParty"
                  value={field.value}
                  onChange={(party) => {
                    field.onChange(party?.id ?? null);
                    // Saves retyping: a party fills in the names that are still empty.
                    if (party) {
                      if (!getValues("name").trim()) setValue("name", party.name);
                      if (!getValues("nameAr").trim() && party.nameAr) setValue("nameAr", party.nameAr);
                    }
                  }}
                />
              )}
            />
          </div>
        ) : null}

        {/* Colour — only for a top-level account (no parent); its whole branch is drawn in it. */}
        {selectedParentId === null ? (
          <div className="erp-field">
            <label id="acctColorLabel">{t("accounting.chartOfAccounts.color")}</label>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <ColorSwatches value={field.value} onChange={field.onChange} labelledBy="acctColorLabel" />
              )}
            />
            <small className="erp-field__hint">{t("accounting.chartOfAccounts.colorHint")}</small>
          </div>
        ) : null}

        {/* Error messages */}
        {isConflict ? (
          <p className="erp-auth-card__error">{t("accounting.chartOfAccounts.duplicateCode")}</p>
        ) : createAccount.isError ? (
          <p className="erp-auth-card__error">{t("accounting.chartOfAccounts.createError")}</p>
        ) : null}

        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} type="button" text onClick={onHideAndReset} />
          <Button label={t("actions.save")} type="submit" loading={createAccount.isPending} />
        </div>
      </form>
    </Dialog>
  );
}

// ─── Edit-account dialog ──────────────────────────────────────────────────────

// Only names, the linked party and (for a top-level account) the colour can change; the code,
// type, parent and postable flag are fixed once an account exists.
const editAccountSchema = z.object({
  name: z.string().trim().min(1, "required"),
  nameAr: z.string(),
  partyId: z.string().nullable(),
  color: z.string().nullable(),
});
type EditAccountValues = z.infer<typeof editAccountSchema>;

function EditAccountDialog({
  account,
  onHide,
}: {
  account: ChartOfAccountEntry | null;
  onHide: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { can } = usePermissions();
  const updateAccount = useUpdateAccount(account?.id ?? "");
  const isTopLevel = account?.parentId === null;

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditAccountValues>({
    resolver: zodResolver(editAccountSchema),
    defaultValues: { name: "", nameAr: "", partyId: null, color: null },
  });

  useEffect(() => {
    if (!account) return;
    updateAccount.reset();
    reset({ name: account.name, nameAr: account.nameAr ?? "", partyId: account.partyId, color: account.color });
    // Reload the form only when another account is opened, not on every re-render.
  }, [account?.id]);

  const onSubmit = handleSubmit((values) => {
    updateAccount.mutate(
      {
        name: values.name,
        nameAr: values.nameAr.trim() || null,
        partyId: values.partyId,
        ...(isTopLevel ? { color: values.color } : {}),
      },
      { onSuccess: onHide },
    );
  });

  return (
    <Dialog
      header={account ? `${t("accounting.chartOfAccounts.editAccount")} — ${account.code}` : ""}
      visible={account !== null}
      onHide={onHide}
      className="erp-dialog"
      modal
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        {account ? (
          <div className="erp-field">
            <label>{t("accounting.chartOfAccounts.id")}</label>
            <CopyId value={account.ref} uuid={account.id} />
          </div>
        ) : null}

        <div className="erp-field">
          <label htmlFor="editAcctName">{t("accounting.chartOfAccounts.nameEn")}</label>
          <InputText id="editAcctName" {...register("name")} className={errors.name ? "p-invalid" : ""} />
          {errors.name ? <small className="erp-field__error">{t("validation.required")}</small> : null}
        </div>

        <div className="erp-field">
          <label htmlFor="editAcctNameAr">{t("accounting.chartOfAccounts.nameAr")}</label>
          <InputText id="editAcctNameAr" dir="rtl" {...register("nameAr")} />
        </div>

        {can("party:read") ? (
          <div className="erp-field">
            <label htmlFor="editAcctParty">{t("accounting.chartOfAccounts.party")}</label>
            <Controller
              control={control}
              name="partyId"
              render={({ field }) => (
                <PartyPicker
                  inputId="editAcctParty"
                  value={field.value}
                  current={account?.party ?? null}
                  onChange={(party) => field.onChange(party?.id ?? null)}
                />
              )}
            />
          </div>
        ) : null}

        {isTopLevel ? (
          <div className="erp-field">
            <label id="editAcctColorLabel">{t("accounting.chartOfAccounts.color")}</label>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <ColorSwatches value={field.value} onChange={field.onChange} labelledBy="editAcctColorLabel" />
              )}
            />
            <small className="erp-field__hint">{t("accounting.chartOfAccounts.colorHint")}</small>
          </div>
        ) : null}

        {updateAccount.isError ? (
          <p className="erp-auth-card__error">{t("accounting.chartOfAccounts.updateError")}</p>
        ) : null}

        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} type="button" text onClick={onHide} />
          <Button label={t("actions.save")} type="submit" loading={updateAccount.isPending} />
        </div>
      </form>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TYPE_SEVERITY = {
  ASSET: "info",
  LIABILITY: "warning",
  EQUITY: "secondary",
  REVENUE: "success",
  EXPENSE: "danger",
} as const;

// Zero (or no activity) shows a dash so a long chart is not a wall of "0.0000".
function amountCell(
  row: AccountBalance | undefined,
  field: "debitTotal" | "creditTotal",
  currency: string,
): React.JSX.Element {
  const value = row?.[field];
  if (value === undefined || value === "0.0000") return <span className="coa-amount coa-amount--zero">—</span>;
  return <span className="coa-amount">{formatMoney(value, currency)}</span>;
}

const LEVEL_CHOICES: readonly LevelChoice[] = [1, 2, 3, 4, "all"];
const DEFAULT_LEVEL: LevelChoice = 2;

function typeLabelKey(type: string): string {
  return `accounting.chartOfAccounts.type${type.charAt(0)}${type.slice(1).toLowerCase()}`;
}

export function ChartOfAccountsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { data, isPending, isError, refetch } = useChartOfAccounts();
  const { can } = usePermissions();
  const { data: currentUser } = useCurrentUser();
  const { data: balanceRows } = useAccountBalances();
  const canSeeTotals = can("trial_balance:read");
  const currency = currentUser?.companyDefaultCurrency ?? "SAR";
  const balances = useMemo(
    () => new Map((balanceRows ?? []).map((row) => [row.accountId, row])),
    [balanceRows],
  );
  const [addVisible, setAddVisible] = useState(false);
  const [editAccount, setEditAccount] = useState<ChartOfAccountEntry | null>(null);
  const [created, setCreated] = useState<CreatedInfo | null>(null);
  // The account being moved and, when it was dropped onto a group, that group.
  const [moving, setMoving] = useState<{ account: ChartOfAccountEntry; parentId: string | null | undefined } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LevelChoice | null>(DEFAULT_LEVEL);
  // Set once the user opens/closes a single row by hand; null means "follow the level
  // buttons or the search".
  const [manualKeys, setManualKeys] = useState<ExpandedKeys | null>(null);

  // All hooks stay above the early returns below.
  const tree = useMemo(() => (data ? buildAccountTree(data) : []), [data]);
  const filtered = useMemo(() => (query.trim() ? filterAccountTree(tree, query) : null), [tree, query]);
  const visibleTree = filtered ? filtered.tree : tree;
  const expandedKeys: ExpandedKeys =
    manualKeys ?? (filtered ? filtered.expandedKeys : level ? expandedKeysForLevel(tree, level) : {});

  const toggleNode = (key: string): void => {
    setManualKeys(toggleExpandedKey(expandedKeys, key));
    setLevel(null);
  };
  // Opens every group above the given groups so an account inside them is on screen (a new or moved account would
  // otherwise sit inside a collapsed group, looking as if it had not been put under it).
  const openGroups = (groupIds: readonly (string | null)[]): void => {
    if (!data) return;
    const opened: ExpandedKeys = { ...expandedKeys };
    for (const groupId of groupIds) {
      if (!groupId) continue;
      opened[groupId] = true;
      for (const id of ancestorIds(data, groupId)) opened[id] = true;
    }
    setQuery("");
    setLevel(null);
    setManualKeys(opened);
  };
  // Whether the dragged account may be dropped on this group (the same rules the server enforces).
  const canDropOn = (target: ChartNodeData): boolean => {
    if (!data || !draggingId || draggingId === target.id || target.isPostable) return false;
    const dragged = data.find((a) => a.id === draggingId);
    if (!dragged || dragged.type !== target.type || dragged.parentId === target.id) return false;
    return !descendantIds(data, dragged.id).has(target.id);
  };
  const changeQuery = (value: string): void => {
    setQuery(value);
    setManualKeys(null);
  };
  const changeLevel = (value: LevelChoice | null): void => {
    if (value === null) return;
    setLevel(value);
    setManualKeys(null);
    setQuery("");
  };
  // A collapsed chevron points toward the reading direction: right in LTR, left in RTL.
  const closedChevron = i18n.dir() === "rtl" ? "pi-chevron-left" : "pi-chevron-right";

  if (isPending) {
    return <PageSkeleton />;
  }

  if (isError || !data) {
    return (
      <div className="erp-page">
        <p className="erp-page__error">{t("status.error")}</p>
        <button type="button" className="erp-button-link" onClick={() => void refetch()}>
          {t("actions.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="erp-page erp-page--wide">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("accounting.chartOfAccounts.title")}</h1>
          <p className="erp-page__subtitle">{t("accounting.chartOfAccounts.subtitle")}</p>
        </div>
        <PermissionButton
          allowed={can("account:create")}
          label={t("accounting.chartOfAccounts.addAccount")}
          icon="pi pi-plus"
          onClick={() => setAddVisible(true)}
        />
      </div>

      {data.length === 0 ? (
        <p className="erp-page__empty">{t("status.empty")}</p>
      ) : (
        <>
          <div className="coa-toolbar">
            <div className="coa-search">
              <InputText
                value={query}
                onChange={(e) => changeQuery(e.target.value)}
                placeholder={t("accounting.chartOfAccounts.searchPlaceholder")}
                aria-label={t("accounting.chartOfAccounts.searchPlaceholder")}
              />
              {query ? (
                <Button
                  type="button"
                  icon="pi pi-times"
                  rounded
                  text
                  severity="secondary"
                  aria-label={t("accounting.chartOfAccounts.clearSearch")}
                  onClick={() => changeQuery("")}
                />
              ) : null}
            </div>
            <div className="coa-levels">
              <span className="coa-levels__label">{t("accounting.chartOfAccounts.level")}</span>
              <SelectButton
                value={level}
                onChange={(e) => changeLevel(e.value as LevelChoice | null)}
                options={LEVEL_CHOICES.map((choice) => ({
                  label: choice === "all" ? t("accounting.chartOfAccounts.levelAll") : String(choice),
                  value: choice,
                }))}
                allowEmpty={false}
              />
            </div>
          </div>

          <TreeTable
            value={visibleTree}
            className="erp-table erp-coa"
            showGridlines
            expandedKeys={expandedKeys}
            onToggle={(e) => {
              setManualKeys(e.value);
              setLevel(null);
            }}
            rowClassName={(node: TreeNode) => {
              const account = node.data as ChartNodeData;
              return {
                [`coa-row--d${Math.min(account.depth, 3)}`]: true,
                [`coa-row--${account.type.toLowerCase()}`]: true,
                // The branch's colour (from its top-level account) arrives as a CSS variable on the row.
                "coa-row--colored": account.branchColor !== null,
              };
            }}
            emptyMessage={query.trim() ? t("accounting.chartOfAccounts.noResults") : t("status.empty")}
          >
            <Column
              header={t("accounting.chartOfAccounts.id")}
              style={{ width: "8rem" }}
              className="coa-col-hide-lg"
              headerClassName="coa-col-hide-lg"
              body={(node: TreeNode) => {
                const account = node.data as ChartNodeData;
                return <CopyId value={account.ref} uuid={account.id} />;
              }}
            />
            <Column
              header={t("accounting.chartOfAccounts.code")}
              style={{ width: "7rem" }}
              body={(node: TreeNode) => <span className="coa-code">{(node.data as ChartNodeData).code}</span>}
            />
            {/* The name gets whatever is left, but never less than this: without a floor the
                fixed-width columns squeeze it until every letter wraps onto its own line. */}
            <Column
              header={t("accounting.chartOfAccounts.name")}
              style={{ minWidth: "14rem" }}
              body={(node: TreeNode) => {
                const account = node.data as ChartNodeData;
                const key = node.key as string;
                const isGroup = (node.children?.length ?? 0) > 0;
                const isOpen = Boolean(expandedKeys[key]);
                return (
                  // Indented with a logical padding driven by --depth, so it nests toward the
                  // correct side under both html[dir=ltr] and html[dir=rtl].
                  <div
                    className={`coa-cell${dropKey === key ? " coa-cell--drop" : ""}`}
                    style={{ "--depth": account.depth } as CSSProperties}
                    draggable={can("account:update")}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", account.id);
                      setDraggingId(account.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropKey(null);
                    }}
                    onDragOver={(e) => {
                      if (!canDropOn(account)) return;
                      e.preventDefault();
                      if (dropKey !== key) setDropKey(key);
                    }}
                    onDragLeave={() => setDropKey((current) => (current === key ? null : current))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropKey(null);
                      const dragged = data.find((a) => a.id === draggingId);
                      setDraggingId(null);
                      if (dragged && canDropOn(account)) setMoving({ account: dragged, parentId: account.id });
                    }}
                  >
                    {isGroup ? (
                      <button
                        type="button"
                        className="coa-toggle"
                        aria-expanded={isOpen}
                        aria-label={
                          isOpen ? t("accounting.chartOfAccounts.collapse") : t("accounting.chartOfAccounts.expand")
                        }
                        onClick={() => toggleNode(key)}
                      >
                        <i className={`pi ${isOpen ? "pi-chevron-down" : closedChevron}`} aria-hidden="true" />
                      </button>
                    ) : (
                      <span className="coa-toggle coa-toggle--spacer" aria-hidden="true" />
                    )}
                    {/* A folder is a group; a file is an account that takes postings. */}
                    <i
                      className={`pi coa-icon ${account.isPostable ? "pi-file" : isOpen ? "pi-folder-open" : "pi-folder"}`}
                      aria-hidden="true"
                    />
                    <span className="coa-name">{localizedName(account, i18n.language)}</span>
                    {account.childCount > 0 ? <span className="coa-count">{account.childCount}</span> : null}
                    {account.party ? (
                      <span className="coa-party" title={t(`parties.kinds.${account.party.kind}`, account.party.kind)}>
                        <i className={partyKindIcon(account.party.kind)} aria-hidden="true" />
                        {localizedName(account.party, i18n.language)}
                      </span>
                    ) : null}
                  </div>
                );
              }}
            />
            {/* Totals come from the server, already rolled up: a parent is the sum of its
                children. Only for users allowed to read the trial balance. */}
            {canSeeTotals
              ? [
                  <Column
                    key="debit"
                    header={t("accounting.trialBalance.debit")}
                    align="right"
                    alignHeader="right"
                    style={{ width: "8rem" }}
                    className="coa-col-hide-sm2"
                    headerClassName="coa-col-hide-sm2"
                    body={(node: TreeNode) => amountCell(balances.get(node.key as string), "debitTotal", currency)}
                  />,
                  <Column
                    key="credit"
                    header={t("accounting.trialBalance.credit")}
                    align="right"
                    alignHeader="right"
                    style={{ width: "8rem" }}
                    className="coa-col-hide-sm2"
                    headerClassName="coa-col-hide-sm2"
                    body={(node: TreeNode) => amountCell(balances.get(node.key as string), "creditTotal", currency)}
                  />,
                  <Column
                    key="balance"
                    header={t("accounting.balanceSheet.balance")}
                    align="right"
                    alignHeader="right"
                    style={{ width: "9.5rem" }}
                    body={(node: TreeNode) => {
                      const row = balances.get(node.key as string);
                      if (!row || row.balanceSide === null) return <span className="coa-amount coa-amount--zero">—</span>;
                      const side =
                        row.balanceSide === "DEBIT" ? t("accounting.trialBalance.debit") : t("accounting.trialBalance.credit");
                      return (
                        <span className="coa-amount">
                          {formatMoney(row.balance, currency)} <small className="coa-side">{side}</small>
                        </span>
                      );
                    }}
                  />,
                ]
              : null}
            <Column
              header={t("accounting.chartOfAccounts.type")}
              style={{ width: "6rem" }}
              className="coa-col-hide-md"
              headerClassName="coa-col-hide-md"
              body={(node: TreeNode) => {
                const account = node.data as ChartNodeData;
                return (
                  <Tag
                    value={t(typeLabelKey(account.type))}
                    severity={TYPE_SEVERITY[account.type as keyof typeof TYPE_SEVERITY] ?? "secondary"}
                  />
                );
              }}
            />
            {/* Edit stays visible but disabled (with the reason on hover) for a user without
                account:update, like the other action buttons. */}
            <Column
              header=""
              style={{ width: "7rem" }}
              body={(node: TreeNode) => (
                <div style={{ display: "flex", gap: "0.15rem" }}>
                  <PermissionButton
                    allowed={can("account:update")}
                    icon="pi pi-pencil"
                    rounded
                    text
                    severity="secondary"
                    aria-label={t("accounting.chartOfAccounts.edit")}
                    onClick={() => setEditAccount(node.data as ChartNodeData)}
                  />
                  <PermissionButton
                    allowed={can("account:update")}
                    icon="pi pi-arrows-alt"
                    rounded
                    text
                    severity="secondary"
                    aria-label={t("accounting.chartOfAccounts.move.button")}
                    tooltip={t("accounting.chartOfAccounts.move.button")}
                    onClick={() => setMoving({ account: node.data as ChartNodeData, parentId: undefined })}
                  />
                </div>
              )}
            />
          </TreeTable>
        </>
      )}

      <AddAccountDialog
        visible={addVisible}
        onHide={() => setAddVisible(false)}
        accounts={data}
        onCreated={(account, info) => {
          setCreated(info);
          openGroups([account.parentId]);
        }}
      />
      <CreatedDialog info={created} onHide={() => setCreated(null)} />
      <MoveAccountDialog
        account={moving?.account ?? null}
        initialParentId={moving?.parentId}
        chart={data}
        onHide={() => setMoving(null)}
        onMoved={(moved) => {
          setMoving(null);
          const parent = moved.parentId ? data.find((a) => a.id === moved.parentId) : undefined;
          setCreated({
            title: t("accounting.chartOfAccounts.move.movedTitle"),
            headline: moved.code,
            rows: [
              { label: t("created.name"), value: localizedName(moved, i18n.language) },
              { label: t("accounting.chartOfAccounts.move.movedTo"), value: parent ? `${parent.code} — ${localizedName(parent, i18n.language)}` : t("accounting.chartOfAccounts.move.topLevel") },
            ],
          });
          openGroups([moved.parentId]);
        }}
      />
      <EditAccountDialog account={editAccount} onHide={() => setEditAccount(null)} />
    </div>
  );
}
