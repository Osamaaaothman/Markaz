import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { TreeTable } from "primereact/treetable";
import type { TreeNode } from "primereact/treenode";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { buildAccountTree } from "./build-account-tree";
import {
  useChartOfAccounts,
  useCreateAccount,
  type ChartOfAccountEntry,
} from "./use-chart-of-accounts";

// ─── Add-account dialog ───────────────────────────────────────────────────────

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

const addAccountSchema = z.object({
  code: z.string().regex(/^\d+$/, "digits only").min(1),
  name: z.string().min(1),
  type: z.enum(ACCOUNT_TYPES),
  isPostable: z.boolean(),
  parentId: z.string().nullable(),
});
type AddAccountValues = z.infer<typeof addAccountSchema>;

function AddAccountDialog({
  visible,
  onHide,
  accounts,
}: {
  visible: boolean;
  onHide: () => void;
  accounts: ChartOfAccountEntry[];
}) {
  const { t } = useTranslation();
  const createAccount = useCreateAccount();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddAccountValues>({
    resolver: zodResolver(addAccountSchema),
    defaultValues: { code: "", name: "", type: "ASSET", isPostable: true, parentId: null },
  });

  const onHideAndReset = () => {
    reset();
    createAccount.reset();
    onHide();
  };

  const onSubmit = handleSubmit((values) => {
    createAccount.mutate(
      {
        code: values.code,
        name: values.name,
        type: values.type,
        isPostable: values.isPostable,
        parentId: values.parentId,
      },
      { onSuccess: onHideAndReset },
    );
  });

  const typeOptions = ACCOUNT_TYPES.map((t_) => ({
    label: t(`accounting.chartOfAccounts.type${t_.charAt(0) + t_.slice(1).toLowerCase()}`),
    value: t_,
  }));

  const parentOptions = [
    { label: t("accounting.chartOfAccounts.noParent"), value: null },
    ...accounts.map((a) => ({ label: `${a.code} — ${a.name}`, value: a.id })),
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
          <InputText
            id="acctCode"
            {...register("code")}
            className={errors.code ? "p-invalid" : ""}
            placeholder="e.g. 1150"
          />
          {errors.code ? (
            <small className="erp-field__error">{t("validation.required")}</small>
          ) : null}
        </div>

        {/* Name */}
        <div className="erp-field">
          <label htmlFor="acctName">{t("accounting.chartOfAccounts.name")}</label>
          <InputText
            id="acctName"
            {...register("name")}
            className={errors.name ? "p-invalid" : ""}
          />
          {errors.name ? (
            <small className="erp-field__error">{t("validation.required")}</small>
          ) : null}
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
                onChange={(e) => field.onChange(e.value)}
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
                value={field.value}
                onChange={(e) => field.onChange(e.value as string | null)}
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

// ─── Main page ────────────────────────────────────────────────────────────────

export function ChartOfAccountsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useChartOfAccounts();
  const [addVisible, setAddVisible] = useState(false);

  const tree = data ? buildAccountTree(data) : [];

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
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("accounting.chartOfAccounts.title")}</h1>
          <p className="erp-page__subtitle">{t("accounting.chartOfAccounts.subtitle")}</p>
        </div>
        <Button
          label={t("accounting.chartOfAccounts.addAccount")}
          icon="pi pi-plus"
          onClick={() => setAddVisible(true)}
        />
      </div>

      {data.length === 0 ? (
        <p className="erp-page__empty">{t("status.empty")}</p>
      ) : (
        <TreeTable value={tree} className="erp-table" showGridlines emptyMessage={t("status.empty")}>
          <Column
            field="code"
            header={t("accounting.chartOfAccounts.code")}
            expander
            style={{ width: "10rem" }}
            body={(node: TreeNode) => (node.data as ChartOfAccountEntry).code}
          />
          <Column
            field="name"
            header={t("accounting.chartOfAccounts.name")}
            body={(node: TreeNode) => (node.data as ChartOfAccountEntry).name}
          />
          <Column
            field="isPostable"
            header={t("accounting.chartOfAccounts.kind")}
            style={{ width: "10rem" }}
            body={(node: TreeNode) => {
              const account = node.data as ChartOfAccountEntry;
              return account.isPostable ? (
                <Tag value={t("accounting.chartOfAccounts.postable")} severity="info" />
              ) : (
                <Tag value={t("accounting.chartOfAccounts.group")} severity="secondary" />
              );
            }}
          />
        </TreeTable>
      )}

      <AddAccountDialog
        visible={addVisible}
        onHide={() => setAddVisible(false)}
        accounts={data}
      />
    </div>
  );
}
