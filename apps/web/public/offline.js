// Separate file (not inline): production sends script-src 'self'. Picks the language the app saved.
(function () {
  var lang = "ar";
  try { lang = localStorage.getItem("erp-lang") === "en" ? "en" : "ar"; } catch (e) {}
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
  document.getElementById("retry").addEventListener("click", function () { window.location.reload(); });
})();
