// Accounts carry an English `name` and an optional Arabic `nameAr`. Arabic UI shows the
// Arabic name when one exists and falls back to English otherwise, so an account
// created with only an English name still displays everywhere.
export function localizedName(entity: { name: string; nameAr?: string | null }, language: string): string {
  const arabic = entity.nameAr?.trim();
  return language.startsWith("ar") && arabic ? arabic : entity.name;
}
