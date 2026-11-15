// The Markaz brand splash controller. A separate file (not inline) because production sends a
// Content-Security-Policy of script-src 'self'. Loaded by index.html before the app bundle.
(function () {
  // Language and light/dark are read from what the app saved, so the splash starts in the right ones.
  try {
    var lang = localStorage.getItem("erp-lang") === "en" ? "en" : "ar";
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
  } catch (e) {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
  }
  try {
    var saved = JSON.parse(localStorage.getItem("erp-theme") || "{}");
    var mode = saved && saved.state && saved.state.mode;
    if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-splash", mode);
  } catch (e) {}

  var el = document.getElementById("markaz-splash");
  if (!el) return;
  var t1 = setTimeout(function () { el.classList.add("waiting"); }, 1500);
  // A failed bundle or an offline session must never leave an endless animation.
  var t2 = setTimeout(function () {
    el.classList.add("failed");
    document.getElementById("markaz-splash-retry").hidden = false;
  }, 20000);
  document.getElementById("markaz-splash-retry").addEventListener("click", function () {
    window.location.reload();
  });
  var done = false;
  window.markazSplash = {
    ready: function () {
      if (done) return;
      done = true;
      clearTimeout(t1);
      clearTimeout(t2);
      el.classList.add("leaving");
      setTimeout(function () { el.remove(); }, 220);
    },
  };
})();
