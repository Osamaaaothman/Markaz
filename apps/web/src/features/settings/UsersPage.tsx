import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { MultiSelect } from "primereact/multiselect";
import { TabPanel, TabView } from "primereact/tabview";
import { Tag } from "primereact/tag";
import { usePermissions } from "../../shared/auth/use-permissions";
import { PageSkeleton } from "../../shared/ui/PageSkeleton";
import { PermissionButton } from "../../shared/ui/PermissionButton";
import { useUsers, useCreateUser, useAssignUserRoles, type UserSummary } from "./use-users";
import { useRoles, usePermissionCatalog, useCreateRole } from "./use-roles";
import { groupPermissionsByResource, splitPermissionCode } from "./permission-labels";

// ─── Add-user dialog ────────────────────────────────────────────────────────

const addUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  roleIds: z.array(z.string()),
});
type AddUserValues = z.infer<typeof addUserSchema>;

function AddUserDialog({ visible, onHide }: { visible: boolean; onHide: () => void }) {
  const { t } = useTranslation();
  const { data: roles } = useRoles();
  const createUser = useCreateUser();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddUserValues>({
    resolver: zodResolver(addUserSchema),
    defaultValues: { roleIds: [] },
  });

  const onHideAndReset = () => {
    reset();
    createUser.reset();
    onHide();
  };

  const onSubmit = handleSubmit((values) => {
    createUser.mutate(
      { email: values.email, password: values.password, roleIds: values.roleIds },
      { onSuccess: onHideAndReset },
    );
  });

  return (
    <Dialog
      header={t("settings.usersRoles.addUser")}
      visible={visible}
      onHide={onHideAndReset}
      className="erp-dialog"
      modal
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        <div className="erp-field">
          <label htmlFor="newUserEmail">{t("settings.usersRoles.email")}</label>
          <InputText
            id="newUserEmail"
            type="email"
            {...register("email")}
            className={errors.email ? "p-invalid" : ""}
          />
          {errors.email ? (
            <small className="erp-field__error">{t("validation.invalidEmail")}</small>
          ) : null}
        </div>

        <div className="erp-field">
          <label htmlFor="newUserPassword">{t("settings.usersRoles.password")}</label>
          <InputText
            id="newUserPassword"
            type="password"
            {...register("password")}
            className={errors.password ? "p-invalid" : ""}
          />
          {errors.password ? (
            <small className="erp-field__error">{t("validation.required")}</small>
          ) : null}
        </div>

        <div className="erp-field">
          <label htmlFor="newUserRoles">{t("settings.usersRoles.roles")}</label>
          <Controller
            control={control}
            name="roleIds"
            render={({ field }) => (
              <MultiSelect
                inputId="newUserRoles"
                value={field.value}
                onChange={(e) => field.onChange(e.value)}
                options={(roles ?? []).map((r) => ({ label: r.name, value: r.id }))}
                display="chip"
                filter
              />
            )}
          />
        </div>

        {createUser.isError ? (
          <p className="erp-auth-card__error">{t("settings.usersRoles.createUserError")}</p>
        ) : null}

        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} type="button" text onClick={onHideAndReset} />
          <Button label={t("actions.save")} type="submit" loading={createUser.isPending} />
        </div>
      </form>
    </Dialog>
  );
}

// ─── Assign-roles dialog ─────────────────────────────────────────────────────

function AssignRolesDialog({ user, onHide }: { user: UserSummary | null; onHide: () => void }) {
  const { t } = useTranslation();
  const { data: roles } = useRoles();
  const assignRoles = useAssignUserRoles(user?.id ?? "");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedIds(user?.roles.map((r) => r.id) ?? []);
    assignRoles.reset();
  }, [user?.id]);

  const onSave = () => {
    assignRoles.mutate(selectedIds, { onSuccess: onHide });
  };

  return (
    <Dialog
      header={t("settings.usersRoles.assignRoles")}
      visible={user !== null}
      onHide={onHide}
      className="erp-dialog"
      modal
    >
      <div className="erp-form">
        <p style={{ marginBlockEnd: "1rem", color: "var(--erp-text-muted)" }}>{user?.email}</p>

        <div className="erp-field">
          <label htmlFor="assignRoleIds">{t("settings.usersRoles.roles")}</label>
          <MultiSelect
            inputId="assignRoleIds"
            value={selectedIds}
            onChange={(e) => setSelectedIds(e.value as string[])}
            options={(roles ?? []).map((r) => ({ label: r.name, value: r.id }))}
            display="chip"
            filter
          />
        </div>

        {assignRoles.isError ? (
          <p className="erp-auth-card__error">{t("settings.usersRoles.assignRolesError")}</p>
        ) : null}

        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} type="button" text onClick={onHide} />
          <Button
            label={t("actions.save")}
            type="button"
            loading={assignRoles.isPending}
            onClick={onSave}
          />
        </div>
      </div>
    </Dialog>
  );
}

// ─── Add-role dialog ─────────────────────────────────────────────────────────

const addRoleSchema = z.object({
  name: z.string().min(1),
  permissionCodes: z.array(z.string()).min(1),
});
type AddRoleValues = z.infer<typeof addRoleSchema>;

function AddRoleDialog({ visible, onHide }: { visible: boolean; onHide: () => void }) {
  const { t } = useTranslation();
  const { data: catalog } = usePermissionCatalog();
  const createRole = useCreateRole();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddRoleValues>({
    resolver: zodResolver(addRoleSchema),
    defaultValues: { permissionCodes: [] },
  });

  const onHideAndReset = () => {
    reset();
    createRole.reset();
    onHide();
  };

  const onSubmit = handleSubmit((values) => {
    createRole.mutate(
      { name: values.name, permissionCodes: values.permissionCodes },
      { onSuccess: onHideAndReset },
    );
  });

  return (
    <Dialog
      header={t("settings.usersRoles.addRole")}
      visible={visible}
      onHide={onHideAndReset}
      className="erp-dialog"
      modal
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="erp-form">
        <div className="erp-field">
          <label htmlFor="roleName">{t("settings.usersRoles.roleName")}</label>
          <InputText
            id="roleName"
            {...register("name")}
            className={errors.name ? "p-invalid" : ""}
          />
          {errors.name ? (
            <small className="erp-field__error">{t("validation.required")}</small>
          ) : null}
        </div>

        <div className="erp-field">
          <label htmlFor="rolePermissions">{t("settings.usersRoles.permissions")}</label>
          <Controller
            control={control}
            name="permissionCodes"
            render={({ field }) => (
              <MultiSelect
                inputId="rolePermissions"
                value={field.value}
                onChange={(e) => field.onChange(e.value)}
                options={(catalog ?? []).map((p) => {
                  const { resource, action } = splitPermissionCode(p.code);
                  return {
                    label: `${t(`settings.usersRoles.resources.${resource}`, resource)} — ${t(`settings.usersRoles.actions.${action}`, action)}`,
                    value: p.code,
                  };
                })}
                display="chip"
                filter
                className={errors.permissionCodes ? "p-invalid" : ""}
              />
            )}
          />
          {errors.permissionCodes ? (
            <small className="erp-field__error">{t("validation.required")}</small>
          ) : null}
        </div>

        {createRole.isError ? (
          <p className="erp-auth-card__error">{t("settings.usersRoles.createRoleError")}</p>
        ) : null}

        <div className="erp-form__actions">
          <Button label={t("actions.cancel")} type="button" text onClick={onHideAndReset} />
          <Button label={t("actions.save")} type="submit" loading={createRole.isPending} />
        </div>
      </form>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function UsersPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const listFormat = new Intl.ListFormat(i18n.language, { style: "narrow", type: "conjunction" });
  const {
    data: users,
    isPending: usersPending,
    isError: usersError,
    refetch: refetchUsers,
  } = useUsers();
  const {
    data: roles,
    isPending: rolesPending,
    isError: rolesError,
    refetch: refetchRoles,
  } = useRoles();
  const { can } = usePermissions();
  const canReadUsers = can("user:read");
  const canReadRoles = can("role:read");

  const [addUserVisible, setAddUserVisible] = useState(false);
  const [addRoleVisible, setAddRoleVisible] = useState(false);
  const [assignTarget, setAssignTarget] = useState<UserSummary | null>(null);

  return (
    <div className="erp-page">
      <div className="erp-page__header">
        <div>
          <h1 className="erp-page__title">{t("settings.usersRoles.title")}</h1>
          <p className="erp-page__subtitle">{t("settings.usersRoles.subtitle")}</p>
        </div>
      </div>

      <TabView>
        {/* ── Users tab ── (only for users who may read users) */}
        {canReadUsers ? (
          <TabPanel header={t("settings.usersRoles.usersTab")}>
            <div className="erp-page__header-actions">
              <PermissionButton
                allowed={can("user:create")}
                label={t("settings.usersRoles.addUser")}
                icon="pi pi-plus"
                onClick={() => setAddUserVisible(true)}
              />
            </div>

            {usersPending ? (
              <PageSkeleton />
            ) : usersError ? (
              <div className="erp-page">
                <p className="erp-page__error">{t("status.error")}</p>
                <button
                  type="button"
                  className="erp-button-link"
                  onClick={() => void refetchUsers()}
                >
                  {t("actions.retry")}
                </button>
              </div>
            ) : (
              <DataTable
                value={users}
                className="erp-table"
                stripedRows
                showGridlines
                size="small"
                emptyMessage={t("status.empty")}
              >
                <Column field="email" header={t("settings.usersRoles.email")} sortable />
                <Column
                  header={t("settings.usersRoles.roles")}
                  body={(row: UserSummary) =>
                    row.roles.length === 0 ? (
                      <span style={{ color: "var(--erp-text-muted)" }}>
                        {t("settings.usersRoles.noRoles")}
                      </span>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                        {row.roles.map((r) => (
                          <Tag key={r.id} value={r.name} severity="secondary" />
                        ))}
                      </div>
                    )
                  }
                />
                <Column
                  header={t("settings.usersRoles.status")}
                  body={(row: UserSummary) => (
                    <Tag
                      value={
                        row.isActive
                          ? t("settings.usersRoles.active")
                          : t("settings.usersRoles.inactive")
                      }
                      severity={row.isActive ? "success" : "warning"}
                    />
                  )}
                  style={{ width: "8rem" }}
                />
                <Column
                  header=""
                  body={(row: UserSummary) => (
                    // The dialog lists the roles to pick from, so it needs role:read as well.
                    <PermissionButton
                      allowed={can("role:assign") && can("role:read")}
                      label={t("settings.usersRoles.assignRoles")}
                      icon="pi pi-users"
                      text
                      size="small"
                      onClick={() => setAssignTarget(row)}
                    />
                  )}
                  style={{ width: "10rem" }}
                />
              </DataTable>
            )}
          </TabPanel>
        ) : null}

        {/* ── Roles tab ── (only for users who may read roles) */}
        {canReadRoles ? (
          <TabPanel header={t("settings.usersRoles.rolesTab")}>
            <div className="erp-page__header-actions">
              <PermissionButton
                allowed={can("role:create")}
                label={t("settings.usersRoles.addRole")}
                icon="pi pi-plus"
                onClick={() => setAddRoleVisible(true)}
              />
            </div>

            {rolesPending ? (
              <PageSkeleton />
            ) : rolesError ? (
              <div className="erp-page">
                <p className="erp-page__error">{t("status.error")}</p>
                <button
                  type="button"
                  className="erp-button-link"
                  onClick={() => void refetchRoles()}
                >
                  {t("actions.retry")}
                </button>
              </div>
            ) : (
              <DataTable
                value={roles}
                className="erp-table"
                stripedRows
                showGridlines
                size="small"
                emptyMessage={t("status.empty")}
              >
                <Column
                  field="name"
                  header={t("settings.usersRoles.roleName")}
                  sortable
                  style={{ width: "12rem" }}
                />
                <Column
                  header={t("settings.usersRoles.permissions")}
                  body={(row: { permissions: readonly string[] }) => (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                      {groupPermissionsByResource(row.permissions).map((group) => (
                        <Tag
                          key={group.resource}
                          severity="info"
                          value={`${t(`settings.usersRoles.resources.${group.resource}`, group.resource)}: ${listFormat.format(
                            group.actions.map((a) => t(`settings.usersRoles.actions.${a}`, a)),
                          )}`}
                        />
                      ))}
                    </div>
                  )}
                />
              </DataTable>
            )}
          </TabPanel>
        ) : null}
      </TabView>

      <AddUserDialog visible={addUserVisible} onHide={() => setAddUserVisible(false)} />
      <AddRoleDialog visible={addRoleVisible} onHide={() => setAddRoleVisible(false)} />
      <AssignRolesDialog user={assignTarget} onHide={() => setAssignTarget(null)} />
    </div>
  );
}
