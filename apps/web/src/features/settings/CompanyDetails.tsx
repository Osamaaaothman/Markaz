import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { apiClient } from "../../shared/api/client";

interface Settings {
  defaultCurrency: string;
  name: string;
  nameAr: string | null;
  version: number;
  identityLocked: boolean;
  years: { id: string; name: string; startDate: string; endDate: string }[];
}
export function CompanyDetails({ canEdit }: { canEdit: boolean }): React.JSX.Element {
  const { t } = useTranslation(),
    qc = useQueryClient();
  const query = useQuery({
    queryKey: ["companySettings"],
    queryFn: async () => (await apiClient.get<Settings>("/v1/company/settings")).data,
  });
  const [name, setName] = useState(""),
    [nameAr, setNameAr] = useState(""),
    [year, setYear] = useState(String(new Date().getFullYear() + 1));
  useEffect(() => {
    if (query.data) {
      setName(query.data.name);
      setNameAr(query.data.nameAr ?? "");
    }
  }, [query.data]);
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ["companySettings"] });
    void qc.invalidateQueries({ queryKey: ["currentUser"] });
    void qc.invalidateQueries({ queryKey: ["setup"] });
    void qc.invalidateQueries({ queryKey: ["fiscalPeriods"] });
  };
  const rename = useMutation({
    mutationFn: () =>
      apiClient.put("/v1/company/settings", { name, nameAr, version: query.data?.version }),
    onSuccess: refresh,
  });
  const addYear = useMutation({
    mutationFn: () => apiClient.post("/v1/company/settings/calendar-years", { year: Number(year) }),
    onSuccess: refresh,
  });
  if (query.isError)
    return (
      <Button
        label={t("actions.retry")}
        onClick={() => {
          void query.refetch();
        }}
      />
    );
  if (!query.data) return <p>{t("drafts.loading")}</p>;
  const locked = !canEdit || query.data.identityLocked;
  return (
    <section className="erp-card">
      <h2>{t("company.details")}</h2>
      <p>
        {t("company.currency")}: <bdi>{query.data.defaultCurrency}</bdi>
      </p>
      {query.data.identityLocked ? <p>{t("company.identityLocked")}</p> : null}
      <div className="erp-form__row">
        <div className="erp-field">
          <label htmlFor="companyNameEn">{t("company.nameEn")}</label>
          <InputText
            id="companyNameEn"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={locked}
          />
        </div>
        <div className="erp-field">
          <label htmlFor="companyNameAr">{t("company.nameAr")}</label>
          <InputText
            id="companyNameAr"
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            disabled={locked}
          />
        </div>
        {!locked ? (
          <Button
            label={t("actions.save")}
            disabled={!name.trim()}
            loading={rename.isPending}
            onClick={() => rename.mutate()}
          />
        ) : null}
      </div>
      {rename.isError ? <p className="erp-field__error">{t("company.changeFailed")}</p> : null}
      <h2>{t("company.fiscalYears")}</h2>
      <p>{t("company.calendarYearHint")}</p>
      <ul>
        {query.data.years.map((fy) => (
          <li key={fy.id}>
            <bdi>
              {fy.name} · {fy.startDate.slice(0, 10)} — {fy.endDate.slice(0, 10)}
            </bdi>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div className="erp-form__row">
          <div className="erp-field">
            <label htmlFor="calendarYear">{t("company.year")}</label>
            <InputText
              id="calendarYear"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <Button
            label={t("company.addYear")}
            disabled={!/^\d{4}$/.test(year)}
            loading={addYear.isPending}
            onClick={() => addYear.mutate()}
          />
        </div>
      ) : null}
      {addYear.isError ? <p className="erp-field__error">{t("company.yearFailed")}</p> : null}
    </section>
  );
}
