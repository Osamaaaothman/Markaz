// UN/ECE Recommendation 20 unit codes accepted by ZATCA Fatoora.
// Source: https://unece.org/trade/uncefact/cl-recommendations (Rec. 20, rev. 17)
// Subset: codes that appear in Saudi trade. Used as the Item.unitCode dropdown source.

export interface UnitCode {
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
}

export const UNIT_CODES: readonly UnitCode[] = [
  // ── Quantity / count ──────────────────────────────────────────────────────
  { code: "PCE", nameEn: "Piece",        nameAr: "قطعة" },
  { code: "SET", nameEn: "Set",          nameAr: "مجموعة" },
  { code: "DZN", nameEn: "Dozen",        nameAr: "دستة" },
  { code: "PR",  nameEn: "Pair",         nameAr: "زوج" },
  { code: "NMP", nameEn: "Pack",         nameAr: "رزمة" },
  { code: "CS",  nameEn: "Case",         nameAr: "علبة" },
  { code: "BX",  nameEn: "Box",          nameAr: "صندوق" },
  { code: "RO",  nameEn: "Roll",         nameAr: "لفة" },
  // ── Mass ─────────────────────────────────────────────────────────────────
  { code: "GRM", nameEn: "Gram",         nameAr: "غرام" },
  { code: "KGM", nameEn: "Kilogram",     nameAr: "كيلوغرام" },
  { code: "TNE", nameEn: "Tonne",        nameAr: "طن" },
  // ── Length ───────────────────────────────────────────────────────────────
  { code: "MTR", nameEn: "Metre",        nameAr: "متر" },
  { code: "CMT", nameEn: "Centimetre",   nameAr: "سنتيمتر" },
  // ── Area ─────────────────────────────────────────────────────────────────
  { code: "MTK", nameEn: "Square metre", nameAr: "متر مربع" },
  // ── Volume ───────────────────────────────────────────────────────────────
  { code: "MTQ", nameEn: "Cubic metre",  nameAr: "متر مكعب" },
  { code: "LTR", nameEn: "Litre",        nameAr: "لتر" },
  { code: "MLT", nameEn: "Millilitre",   nameAr: "مليلتر" },
  // ── Time / service ───────────────────────────────────────────────────────
  { code: "HUR", nameEn: "Hour",         nameAr: "ساعة" },
  { code: "DAY", nameEn: "Day",          nameAr: "يوم" },
  { code: "WEE", nameEn: "Week",         nameAr: "أسبوع" },
  { code: "MON", nameEn: "Month",        nameAr: "شهر" },
  { code: "ANN", nameEn: "Year",         nameAr: "سنة" },
];

export const UNIT_CODE_MAP: Readonly<Record<string, UnitCode>> = Object.fromEntries(
  UNIT_CODES.map((u) => [u.code, u]),
);

export const DEFAULT_UNIT_CODE = "PCE";
