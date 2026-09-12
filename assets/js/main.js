// 拾光記 · 图片灯箱
(function () {
  "use strict";

  function openLightbox(src, caption) {
    // 复用已有遮罩，避免重复创建
    let overlay = document.querySelector(".lightbox-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "lightbox-overlay";

      const img = document.createElement("img");
      img.className = "lightbox-img";
      overlay.appendChild(img);

      const close = document.createElement("button");
      close.className = "lightbox-close";
      close.setAttribute("aria-label", "关闭");
      close.textContent = "×";
      overlay.appendChild(close);

      const cap = document.createElement("div");
      cap.className = "lightbox-caption";
      overlay.appendChild(cap);

      const hint = document.createElement("div");
      hint.className = "lightbox-hint";
      hint.textContent = "点击任意处关闭";
      overlay.appendChild(hint);

      document.body.appendChild(overlay);
    }

    overlay.querySelector(".lightbox-img").src = src;
    const cap = overlay.querySelector(".lightbox-caption");
    cap.textContent = caption || "";
    cap.style.display = caption ? "" : "none";

    overlay.classList.add("visible");
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    const overlay = document.querySelector(".lightbox-overlay");
    if (!overlay) return;
    overlay.classList.remove("visible");
    document.body.style.overflow = "";
  }

  document.addEventListener("click", function (e) {
    // 点关闭按钮
    if (e.target.closest(".lightbox-close")) {
      closeLightbox();
      return;
    }

    // 点遮罩背景
    const overlay = e.target.closest(".lightbox-overlay");
    if (overlay && e.target === overlay) {
      closeLightbox();
      return;
    }

    // 点带 lightbox 链接的图片
    const link = e.target.closest("a.lightbox");
    if (link) {
      e.preventDefault();
      openLightbox(link.getAttribute("href"), link.getAttribute("data-caption") || "");
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeLightbox();
    }
  });
})();
