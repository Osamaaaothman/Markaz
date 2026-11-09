import { useEffect } from "react";
import { addLocale, locale } from "primereact/api";
import { useTranslation } from "react-i18next";

// PrimeReact ships English strings only. Arabic text for the parts we use: the column filter menu, the date
// picker and the generic buttons. English falls back to PrimeReact's own defaults.
addLocale("ar", {
  firstDayOfWeek: 6,
  dayNames: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  dayNamesShort: ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"],
  dayNamesMin: ["ح", "ن", "ث", "ر", "خ", "ج", "س"],
  monthNames: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
  monthNamesShort: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
  today: "اليوم",
  clear: "مسح",
  apply: "تطبيق",
  accept: "نعم",
  reject: "لا",
  choose: "اختيار",
  upload: "رفع",
  cancel: "إلغاء",
  weekHeader: "أسبوع",
  startsWith: "يبدأ بـ",
  contains: "يحتوي",
  notContains: "لا يحتوي",
  endsWith: "ينتهي بـ",
  equals: "يساوي",
  notEquals: "لا يساوي",
  noFilter: "بدون فلتر",
  filter: "فلتر",
  lt: "أقل من",
  lte: "أقل من أو يساوي",
  gt: "أكبر من",
  gte: "أكبر من أو يساوي",
  dateIs: "التاريخ هو",
  dateIsNot: "التاريخ ليس",
  dateBefore: "قبل",
  dateAfter: "بعد",
  matchAll: "تطابق الكل",
  matchAny: "تطابق أي",
  addRule: "إضافة شرط",
  removeRule: "حذف الشرط",
  emptyFilterMessage: "لا نتائج",
  emptyMessage: "لا توجد خيارات",
  aria: {
    trueLabel: "نعم",
    falseLabel: "لا",
    nullLabel: "غير محدد",
    pageLabel: "صفحة",
    firstPageLabel: "الصفحة الأولى",
    lastPageLabel: "الصفحة الأخيرة",
    nextPageLabel: "التالية",
    prevPageLabel: "السابقة",
    rowsPerPageLabel: "عدد الصفوف",
    close: "إغلاق",
    filterConstraint: "شرط الفلتر",
    filterOperator: "عامل الفلتر",
  },
});

export function usePrimeLocale(): void {
  const { i18n } = useTranslation();
  useEffect(() => {
    locale(i18n.language === "ar" ? "ar" : "en");
  }, [i18n.language]);
}
