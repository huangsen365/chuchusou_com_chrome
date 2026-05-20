(function () {
  "use strict";

  function switchLang(lang) {
    document.querySelectorAll(".language-section").forEach((section) => {
      section.classList.remove("active");
    });

    document.getElementById(`lang-${lang}`)?.classList.add("active");

    document.querySelectorAll(".lang-toggle button").forEach((button) => {
      button.classList.remove("active");
    });
    document.getElementById(`btn-${lang}`)?.classList.add("active");
  }

  function showEmail(event) {
    event?.preventDefault();

    const encodedEmail = "c3VwcG9ydEBjaHVjaHVzb3UuY29t";
    const email = atob(encodedEmail);

    for (const link of document.querySelectorAll("[data-email-link]")) {
      link.href = `mailto:${email}`;
      link.textContent = email;
      link.removeAttribute("data-email-link");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-lang]").forEach((button) => {
      button.addEventListener("click", () => {
        switchLang(button.dataset.lang);
      });
    });

    document.querySelectorAll("[data-email-link]").forEach((link) => {
      link.addEventListener("click", showEmail);
    });
  });
})();
