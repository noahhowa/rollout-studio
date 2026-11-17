/* About page. */
"use strict";
/* ═══ ABOUT ═══ */
function renderAbout() {
  var el = document.getElementById("pAbout");
  el.innerHTML = "";
  var w = document.createElement("div");
  w.className = "about-wrap";
  var h =
    '<div class="about-back"><button class="btn btn-ghost btn-sm" id="aboutBackBtn">' +
    t("backToTool") +
    "</button></div>";
  h += '<div class="about-hero"><p class="sub">' + t("aboutDesc") + "</p></div>";
  h +=
    '<div class="about-video" id="aboutVideo"><iframe id="ytFrame" src="https://www.youtube-nocookie.com/embed/khan4I6E1A4?rel=0&modestbranding=1" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe><div class="vfallback" id="ytFallback"><a href="https://youtu.be/khan4I6E1A4" target="_blank" rel="noopener">' +
    t("ytFallback") +
    "</a></div></div>";
  h += '<div class="about-section"><h2>' + t("howItWorks") + "</h2>";
  h += '<div class="about-steps">';
  var badges = [
    "badgeUser",
    "badgeUser",
    "badgeLocal",
    "badgeLocal",
    "badgeUser",
    "badgeAPI",
    "badgeUser",
    "badgeLocal",
  ];
  var hwKeys = ["hw1", "hw2", "hw3", "hw4", "hw5", "hw6", "hw7", "hw8"];
  for (var i = 0; i < 8; i++)
    h +=
      '<div class="about-step"><span class="step-badge">' +
      t(badges[i]) +
      "</span><span>" +
      t(hwKeys[i]) +
      "</span></div>";
  h += "</div></div>";
  h +=
    '<div class="about-github"><a href="https://github.com/noahhowa/rollout-studio" target="_blank" rel="noopener"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg></a></div>';
  w.innerHTML = h;
  el.appendChild(w);
  document.getElementById("aboutBackBtn").onclick = function () {
    showingAbout = false;
    document.getElementById("pAbout").classList.remove("active");
    go(returnPage);
  };
  var fr = document.getElementById("ytFrame");
  if (fr) {
    fr.onerror = function () {
      document.getElementById("ytFallback").style.display = "flex";
      fr.style.display = "none";
    };
  }
  setTimeout(function () {
    try {
      var f = document.getElementById("ytFrame");
      if (f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerHTML === "")
        throw 0;
    } catch (e) {
      var fb = document.getElementById("ytFallback");
      if (fb) fb.style.display = "flex";
    }
  }, 3000);
}
function showAbout() {
  if (stitchRunning) return;
  showingAbout = true;
  returnPage = cur;
  document.querySelectorAll(".page").forEach(function (p) {
    p.classList.remove("active");
  });
  document.getElementById("pAbout").classList.add("active");
  document.getElementById("bottombar").style.display = "none";
  document.getElementById("stepper").style.opacity = ".3";
  document.getElementById("stepper").style.pointerEvents = "none";
  renderAbout();
}
document.getElementById("aboutBtn").onclick = showAbout;
document.getElementById("logoBtn").onclick = function () {
  if (showingAbout) {
    showingAbout = false;
    document.getElementById("pAbout").classList.remove("active");
    go(returnPage);
  } else {
    go(0);
  }
};
