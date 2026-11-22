import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeWrite } from "./write-intent.ts";

test("write requests in Arabic and English are spotted", () => {
  for (const t of ["أنشئ عرض سعر بقيمة 200 لكراسي", "انشئلي عرض سعر", "اضف عميل اسمه أحمد", "احذف المورد", "عدّل راتب سامي", "create a customer", "Please add an item"]) {
    assert.equal(looksLikeWrite(t), true, t);
  }
});

test("questions are not", () => {
  for (const t of ["اعطيني آخر 3 قيود", "كم رصيد الصندوق؟", "كيف أنشئ عرض سعر؟", "ما هي الأصناف تحت حد الطلب", "show me the last invoices", "how do I create a customer?"]) {
    assert.equal(looksLikeWrite(t), false, t);
  }
});
