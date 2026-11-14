import { useTranslation } from "react-i18next";
import { DESIGN_DIRECTIONS, useThemeStore, type DesignStyle } from "./theme-store";
import { ChoiceSelect } from "../ui/ChoiceSelect";

/** Changes only appearance. The current route and mounted form state stay intact. */
export function DirectionPicker(): React.JSX.Element {
  const { t } = useTranslation();
  const direction = useThemeStore((state) => state.direction);
  const setDirection = useThemeStore((state) => state.setDirection);
  return (
    <div className="mk-direction-select">
      <i className="pi pi-palette" aria-hidden="true" />
      <ChoiceSelect<DesignStyle>
        label={t("interfaceSettings.direction")}
        value={direction}
        onChange={setDirection}
        options={[
          { value: "original", label: t("interfaceSettings.originalLook") },
          ...DESIGN_DIRECTIONS.map(({ id }) => ({
            value: id,
            label: t(`interfaceSettings.directions.${id}.name`),
          })),
        ]}
      />
    </div>
  );
}

export function DirectionSettings(): React.JSX.Element {
  const { t } = useTranslation();
  const direction = useThemeStore((state) => state.direction);
  const setDirection = useThemeStore((state) => state.setDirection);
  return (
    <section className="erp-card">
      <h2 className="erp-card__title">{t("interfaceSettings.direction")}</h2>
      <p className="mk-direction-hint">{t("interfaceSettings.directionHint")}</p>
      <fieldset className="mk-directions">
        <legend className="mk-sr-only">{t("interfaceSettings.direction")}</legend>
        {DESIGN_DIRECTIONS.map(({ id }) => (
          <label key={id} className={`mk-direction-card mk-direction-card--${id}`}>
            <input
              type="radio"
              name="design-direction"
              value={id}
              checked={direction === id}
              onChange={() => setDirection(id)}
            />
            <span className="mk-direction-card__drawing" aria-hidden="true">
              <span className="mk-direction-card__rail">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="mk-direction-card__workspace">
                <b />
                <span>
                  <i />
                  <i />
                  <i />
                </span>
                <em />
                <em />
                <em />
              </span>
            </span>
            <span className="mk-direction-card__heading">
              <strong>{t(`interfaceSettings.directions.${id}.name`)}</strong>
              {id === "balance" ? <small>{t("interfaceSettings.recommended")}</small> : null}
            </span>
            <span className="mk-direction-card__description">
              {t(`interfaceSettings.directions.${id}.description`)}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="mk-direction-hint">{t("interfaceSettings.directionRestore")}</p>
    </section>
  );
}
