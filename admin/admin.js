(function () {
  "use strict";

  let currentIssueNumber = null;
  let editingFile = null;

  const $ = (sel) => document.querySelector(sel);

  async function api(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "请求失败");
    return data;
  }

  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
    }[c]));
  }

  // ---------- 期数 ----------

  async function loadIssues() {
    const issues = await api("/api/issues");
    const list = $("#issueList");
    if (!issues.length) {
      list.innerHTML = '<li class="empty">暂无期数</li>';
      return;
    }
    list.innerHTML = issues
      .map(
        (i) => `<li class="issue-item" data-number="${esc(i.number)}">
          <span class="issue-item-name">第 ${esc(i.number)} 期 · ${esc(i.title)}</span>
          <span class="issue-item-count">${i.articleCount}</span>
        </li>`
      )
      .join("");
    list.querySelectorAll(".issue-item").forEach((li) => {
      li.addEventListener("click", () => selectIssue(li.dataset.number));
    });
  }

  async function selectIssue(number) {
    currentIssueNumber = number;
    document.querySelectorAll(".issue-item").forEach((li) => {
      li.classList.toggle("active", li.dataset.number === number);
    });
    const articles = await api(`/api/issues/${number}/articles`);
    const issue = (await api("/api/issues")).find((i) => String(i.number) === String(number));
    $("#issueTitle").textContent = issue ? `第 ${number} 期 · ${issue.title}` : `第 ${number} 期`;
    $("#newArticleBtn").disabled = false;
    renderArticles(articles);
  }

  function renderArticles(articles) {
    const list = $("#articleList");
    if (!articles.length) {
      list.innerHTML = '<p class="empty">还没有文章，点右上角「新建文章」</p>';
      return;
    }
    list.innerHTML = articles
      .map(
        (a) => `
        <div class="article-item">
          <div class="article-item-info">
            <span class="tag">${esc(a.section)}</span>
            <h4>${esc(a.title)}</h4>
            <span class="date">${esc(a.date)}</span>
          </div>
          <div class="article-item-actions">
            <button class="btn-ghost btn-sm edit-btn" data-file="${esc(a.file)}">编辑</button>
            <button class="btn-danger delete-btn" data-file="${esc(a.file)}">删除</button>
          </div>
        </div>`
      )
      .join("");
    list.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => openEdit(btn.dataset.file));
    });
    list.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("确认删除这篇文章？")) return;
        try {
          await api(`/api/issues/${currentIssueNumber}/articles/${btn.dataset.file}`, { method: "DELETE" });
          toast("已删除");
          selectIssue(currentIssueNumber);
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  }

  // ---------- 弹窗 ----------

  function openModal(sel) {
    $(sel).classList.remove("hidden");
  }
  function closeModal(sel) {
    $(sel).classList.add("hidden");
  }
  document.querySelectorAll(".cancel").forEach((b) =>
    b.addEventListener("click", () => {
      closeModal("#issueModal");
      closeModal("#articleModal");
    })
  );

  // ---------- 新建期 ----------

  $("#newIssueBtn").addEventListener("click", () => openModal("#issueModal"));
  $("#issueForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await api("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      closeModal("#issueModal");
      form.reset();
      toast("期已创建");
      loadIssues();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- 新建文章 ----------

  function setSection(value) {
    $("#sectionInput").value = value;
    document.querySelectorAll("#sectionSeg .seg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.value === value);
    });
  }

  document.querySelectorAll("#sectionSeg .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => setSection(btn.dataset.value));
  });

  async function openEdit(file) {
    const a = await api(`/api/issues/${currentIssueNumber}/articles/${file}`);
    editingFile = file;
    const form = $("#articleForm");
    form.title.value = a.title || "";
    setSection(a.section || "旅行志");
    form.date.value = a.date || "";
    form.excerpt.value = a.excerpt || "";
    form.body.value = a.body || "";
    form.cover.value = "";
    form.images.value = "";
    $("#articleModalTitle").textContent = "编辑文章";
    openModal("#articleModal");
  }

  $("#newArticleBtn").addEventListener("click", () => {
    editingFile = null;
    $("#articleForm").reset();
    setSection("旅行志");
    $("#articleModalTitle").textContent = "新建文章";
    openModal("#articleModal");
  });
  $("#articleForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    try {
      if (editingFile) {
        await api(`/api/issues/${currentIssueNumber}/articles/${editingFile}`, { method: "PUT", body: fd });
        toast("文章已更新");
      } else {
        fd.append("issueNumber", currentIssueNumber);
        await api("/api/articles", { method: "POST", body: fd });
        toast("文章已保存");
      }
      closeModal("#articleModal");
      form.reset();
      editingFile = null;
      selectIssue(currentIssueNumber);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---------- 发布 ----------

  $("#buildBtn").addEventListener("click", async () => {
    const btn = $("#buildBtn");
    btn.disabled = true;
    btn.textContent = "发布中…";
    try {
      await api("/api/build", { method: "POST" });
      toast("已发布，去「预览杂志」看看");
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "发布";
    }
  });

  // ---------- 初始化 ----------

  loadIssues().catch((err) => toast(err.message, true));
})();
