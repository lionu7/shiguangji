import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const ISSUES_DIR = path.join(ROOT, "issues");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const ASSETS_DIR = path.join(ROOT, "assets");
const DIST_DIR = path.join(ROOT, "dist");

const SECTION_ORDER = ["旅行志", "摄影集", "随笔", "好奇清单"];
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

const site = JSON.parse(fs.readFileSync(path.join(ROOT, "site.json"), "utf8"));

// ---------- 工具 ----------

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseFrontmatter(md) {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: md };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    data[key] = value;
  }
  return { data, body: md.slice(match[0].length) };
}

function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

// 把 originals/xxx.jpg 转成优化图 images/xxx.webp
function toOptimized(src) {
  const base = path.parse(src).name;
  return "images/" + base + ".webp";
}

function toThumb(src) {
  const base = path.parse(src).name;
  return "images/" + base + "-thumb.webp";
}

function makeCoverHTML(coverSrc, alt, prefix = "", ratio = "landscape") {
  if (!coverSrc) return "";
  return `<img class="cover-${ratio}" src="${escapeHtml(prefix + toOptimized(coverSrc))}" alt="${escapeHtml(alt)}">`;
}

// ---------- 图片处理 ----------

async function processImages(issueSrcDir, issueDistDir) {
  const originalsSrc = path.join(issueSrcDir, "originals");
  const imagesDist = path.join(issueDistDir, "images");
  const originalsDist = path.join(issueDistDir, "originals");
  const ratios = {};

  fs.mkdirSync(imagesDist, { recursive: true });
  if (!fs.existsSync(originalsSrc)) return ratios;

  fs.mkdirSync(originalsDist, { recursive: true });
  const files = fs.readdirSync(originalsSrc).filter((f) => IMAGE_EXT.test(f));

  for (const f of files) {
    const src = path.join(originalsSrc, f);
    const base = path.parse(f).name;

    fs.copyFileSync(src, path.join(originalsDist, f));

    // .rotate() 会按 EXIF orientation 自动旋转，修复竖拍照片躺倒
    const meta = await sharp(src).rotate().metadata();
    ratios[base] = meta.height > meta.width ? "portrait" : "landscape";

    await sharp(src)
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(path.join(imagesDist, base + ".webp"));

    await sharp(src)
      .rotate()
      .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(path.join(imagesDist, base + "-thumb.webp"));
  }

  return ratios;
}

// ---------- Markdown 渲染 ----------

function markdownToHtml(md) {
  const renderer = new marked.Renderer();

  renderer.image = function (href, title, text) {
    const src = href || "";
    const rawAlt = text || "";
    const alt = rawAlt === "图" ? "" : rawAlt;
    if (src.startsWith("originals/")) {
      const optimized = toOptimized(src);
      const caption = alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : "";
      return (
        `<figure><a class="lightbox" href="${escapeHtml(src)}" data-caption="${escapeHtml(alt)}">` +
        `<img src="${escapeHtml(optimized)}" alt="${escapeHtml(alt)}" loading="lazy"></a>${caption}</figure>`
      );
    }
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  };

  return marked.parse(md, { renderer });
}

// ---------- 解析期数 ----------

async function parseIssue(dirName) {
  const srcDir = path.join(ISSUES_DIR, dirName);
  const issueJson = JSON.parse(fs.readFileSync(path.join(srcDir, "issue.json"), "utf8"));
  const number = issueJson.number || dirName;

  const articles = [];
  const files = fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  for (const f of files) {
    const raw = fs.readFileSync(path.join(srcDir, f), "utf8");
    const { data, body } = parseFrontmatter(raw);
    const order = f.match(/^(\d+)/)?.[1] || f.replace(/\.md$/, "");
    articles.push({
      order,
      title: data.title || f.replace(/\.md$/, ""),
      section: data.section || "随笔",
      date: data.date || "",
      cover: data.cover || "",
      excerpt: data.excerpt || "",
      html: markdownToHtml(body),
    });
  }

  return { dirName, number, issueJson, articles };
}

// ---------- 渲染 ----------

function renderHome(issues) {
  const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, "home.html"), "utf8");

  const cards = issues
    .map((issue) => {
      const { number, issueJson } = issue;
      const ratio = issue.ratios?.[path.parse(issueJson.cover || "").name] || "landscape";
      const coverHTML = makeCoverHTML(issueJson.cover, issueJson.title, `issues/${number}/`, ratio);
      return (
        `<a class="issue-card" href="issues/${escapeHtml(number)}/index.html">` +
        `<div class="issue-card-cover">${coverHTML}</div>` +
        `<div class="issue-card-body">` +
        `<span class="card-tag">第 ${escapeHtml(number)} 期</span>` +
        `<h3 class="issue-card-title">${escapeHtml(issueJson.title)}</h3>` +
        `<span class="issue-card-date">${escapeHtml(issueJson.date)}</span>` +
        `</div></a>`
      );
    })
    .join("\n");

  const html = render(tpl, {
    title: site.title,
    tagline: site.tagline,
    footer: site.footer,
    issues: cards,
  });

  fs.writeFileSync(path.join(DIST_DIR, "index.html"), html);
}

function renderIssue(issue, allIssues) {
  const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, "issue.html"), "utf8");
  const { number, issueJson, articles } = issue;

  const articleCards = articles
    .map((a) => {
      const thumb = a.cover
        ? `<div class="article-card-thumb"><img src="${escapeHtml(toThumb(a.cover))}" alt=""></div>`
        : "";
      return (
        `<a class="article-card" href="${escapeHtml(a.order)}.html">` +
        thumb +
        `<div class="article-card-body">` +
        `<span class="card-tag">${escapeHtml(a.section)}</span>` +
        `<h3 class="article-card-title">${escapeHtml(a.title)}</h3>` +
        (a.excerpt ? `<p class="article-card-excerpt">${escapeHtml(a.excerpt)}</p>` : "") +
        `<span class="article-card-date">${escapeHtml(a.date)}</span>` +
        `</div></a>`
      );
    })
    .join("\n");

  const idx = allIssues.indexOf(issue);
  const prev = allIssues[idx - 1];
  const next = allIssues[idx + 1];
  const prevHTML = prev
    ? `<a class="pager-link" href="../${escapeHtml(prev.number)}/index.html">← 第 ${escapeHtml(prev.number)} 期</a>`
    : `<span class="pager-empty"></span>`;
  const nextHTML = next
    ? `<a class="pager-link" href="../${escapeHtml(next.number)}/index.html">第 ${escapeHtml(next.number)} 期 →</a>`
    : `<span class="pager-empty"></span>`;

  const html = render(tpl, {
    title: site.title,
    tagline: site.tagline,
    footer: site.footer,
    number,
    issueTitle: issueJson.title,
    subtitle: issueJson.subtitle || "",
    date: issueJson.date || "",
    intro: issueJson.intro || "",
    articles: articleCards,
    prevHTML,
    nextHTML,
  });

  fs.writeFileSync(path.join(DIST_DIR, "issues", number, "index.html"), html);
}

function renderArticles(issue) {
  const tpl = fs.readFileSync(path.join(TEMPLATES_DIR, "article.html"), "utf8");
  const { number, issueJson, articles } = issue;

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const prev = articles[i - 1];
    const next = articles[i + 1];
    const prevHTML = prev
      ? `<a class="pager-link" href="${escapeHtml(prev.order)}.html">← ${escapeHtml(prev.title)}</a>`
      : `<span class="pager-empty"></span>`;
    const nextHTML = next
      ? `<a class="pager-link" href="${escapeHtml(next.order)}.html">${escapeHtml(next.title)} →</a>`
      : `<span class="pager-empty"></span>`;

    const html = render(tpl, {
      title: site.title,
      tagline: site.tagline,
      footer: site.footer,
      issueNumber: number,
      issueTitle: issueJson.title,
      articleTitle: a.title,
      section: a.section,
      date: a.date,
      excerpt: a.excerpt,
      coverHTML: a.cover
        ? `<div class="article-cover">${makeCoverHTML(a.cover, a.title, "", issue.ratios?.[path.parse(a.cover).name] || "landscape")}</div>`
        : "",
      content: a.html,
      prevHTML,
      nextHTML,
    });

    fs.writeFileSync(path.join(DIST_DIR, "issues", number, a.order + ".html"), html);
  }
}

// ---------- 主流程 ----------

async function main() {
  console.log("开始构建……");

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST_DIR, "issues"), { recursive: true });
  fs.cpSync(ASSETS_DIR, path.join(DIST_DIR, "assets"), { recursive: true });

  const dirNames = fs
    .readdirSync(ISSUES_DIR)
    .filter((d) => !d.startsWith(".") && fs.statSync(path.join(ISSUES_DIR, d)).isDirectory());

  const issues = [];
  for (const dirName of dirNames) {
    const issue = await parseIssue(dirName);
    const issueDistDir = path.join(DIST_DIR, "issues", issue.number);
    fs.mkdirSync(issueDistDir, { recursive: true });
    issue.ratios = await processImages(path.join(ISSUES_DIR, dirName), issueDistDir);
    issues.push(issue);
  }

  issues.sort((a, b) => a.number.localeCompare(b.number));

  renderHome(issues);
  for (const issue of issues) {
    renderIssue(issue, issues);
    renderArticles(issue);
  }

  console.log(`构建完成：${issues.length} 期，输出到 dist/`);
}

main().catch((err) => {
  console.error("构建失败：", err);
  process.exit(1);
});
