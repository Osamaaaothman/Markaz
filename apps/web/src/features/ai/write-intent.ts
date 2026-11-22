// Spots a request to create or change data before it reaches the model, so question mode can offer
// the switch at once (no provider call, no tokens). Deliberately narrow: only a sentence that STARTS
// with a write verb counts. Anything it misses is still caught by the model's switch tool.
const AR = /^(?:من\s+فضلك\s+|لو\s+سمحت\s+|ممكن\s+)?(?:أ|ا|إ)?(?:نشئ|نشي|ضف|ضيف|عمل|عمللي|سجل|سجّل|حذف|مسح|عدل|عدّل|غير|غيّر|صدر|صدّر|نشئلي|نشئ لي)|^(?:أضف|اضف|ضيف|سوي|سوّي|اعمل|اعملي|سجّل|سجل|احذف|امسح|عدّل|عدل|غيّر|غير|حدّث|حدث|أنشئ|انشئ|انشئلي|أنشئلي|اصدر|أصدر|ادخل|أدخل)/u;
const EN = /^(?:please\s+)?(?:create|add|make|new|register|record|delete|remove|update|edit|change|issue|post|enter)\b/i;

export function looksLikeWrite(text: string): boolean {
  const t = text.trim().replace(/^[«"'(\s]+/u, "");
  return AR.test(t) || EN.test(t);
}
