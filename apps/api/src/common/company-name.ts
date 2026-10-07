// The company's name as it should print in a document of the given language: the Arabic name in an Arabic document
// when one is set, otherwise the registered (English) name.
export function localizedCompanyName(company: { readonly name: string; readonly nameAr?: string | null }, language: string): string {
  const arabic = company.nameAr?.trim();
  return language === "ar" && arabic ? arabic : company.name;
}
