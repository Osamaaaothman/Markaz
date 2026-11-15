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
  var MIN_MS = 5000; // always shown for at least 5 s, even if the data arrives sooner
  var t0 = performance.now();
  var t1 = setTimeout(function () { el.classList.add("waiting"); }, 1500);
  var t2 = setTimeout(function () { el.classList.add("slow"); }, 4000);
  var done = false;
  window.markazSplash = {
    ready: function () {
      if (done) return;
      done = true;
      var wait = Math.max(0, MIN_MS - (performance.now() - t0));
      setTimeout(function () {
        clearTimeout(t1);
        clearTimeout(t2);
        el.classList.add("leaving");
        setTimeout(function () { el.remove(); }, 220);
      }, wait);
    },
  };
})();
