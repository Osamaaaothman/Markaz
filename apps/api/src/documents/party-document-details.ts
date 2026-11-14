import { escapeHtml } from "../common/html-escape.js";
import { getDocumentTranslator, type SupportedDocumentLanguage } from "../i18n/server-i18n.js";

export interface PartyDocumentDetails {
  readonly vatNumber: string | null;
  readonly commercialRegistration: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly streetName: string | null;
  readonly additionalStreetName: string | null;
  readonly buildingNumber: string | null;
  readonly additionalNumber: string | null;
  readonly district: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
}

export async function renderPartyDocumentDetails(party: PartyDocumentDetails | null | undefined, language: SupportedDocumentLanguage): Promise<string> {
  if (!party) return "";
  const t = await getDocumentTranslator(language);
  const address = [party.buildingNumber, party.streetName, party.additionalStreetName, party.district, party.city, party.postalCode, party.additionalNumber, party.countryCode].filter(Boolean).join(language === "ar" ? "، " : ", ");
  return [
    party.vatNumber ? `${t("seller.vatNumber")}: ${party.vatNumber}` : null,
    party.commercialRegistration ? `${t("seller.crNumber")}: ${party.commercialRegistration}` : null,
    address, party.phone ? `${t("seller.phone")}: ${party.phone}` : null, party.email,
  ].filter((value): value is string => Boolean(value)).map((line) => `<span class="party-detail"><bdi dir="auto">${escapeHtml(line)}</bdi></span>`).join("");
}
