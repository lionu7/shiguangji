import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const ISSUES_DIR = path.join(ROOT, "issues");
const ADMIN_DIR = path.join(ROOT, "admin");
const TMP_DIR = path.join(ROOT, ".tmp");
const DIST_DIR = path.join(ROOT, "dist");

const PORT = process.env.PORT || 4321;

const app = express();
app.use(express.json());

app.use(express.static(DIST_DIR));
app.use("/admin", express.static(ADMIN_DIR));

fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({ dest: TMP_DIR });

// ---------- 工具 ----------

function listIssueDirs() {
  if (!fs.existsSync(ISSUES_DIR)) return [];
  return fs.readdirSync(ISSUES_DIR).filter((d) => {
    const p = path.join(ISSUES_DIR, d);
    return !d.startsWith(".") && fs.statSync(p).isDirectory();
  });
}

function readIssue(dirName) {
  const jsonPath = path.join(ISSUES_DIR, dirName, "issue.json");
  if (!fs.existsSync(jsonPath)) return null;
  return { dirName, ...JSON.parse(fs.readFileSync(jsonPath, "utf8")) };
}

function listIssues() {
  return listIssueDirs()
    .map((dirName) => {
      const issue = readIssue(dirName);
      if (!issue) return null;
      const dir = path.join(ISSUES_DIR, dirName);
      const articleCount = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).length;
      return { ...issue, articleCount };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.number).localeCompare(String(b.number)));
}

function findIssueDir(number) {
  return listIssueDirs().find((d) => {
    const issue = readIssue(d);
    return issue && String(issue.number) === String(number);
  });
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

function safeName(str) {
  return String(str).replace(/[\\/:*?"<>|]/g, "").trim();
}

function buildMarkdown({ title, section, date, excerpt, body, coverRel, imageRels }) {
  let fm = "---\n";
  fm += `title: ${title}\n`;
  if (section) fm += `section: ${section}\n`;
  if (date) fm += `date: ${date}\n`;
  if (coverRel) fm += `cover: ${coverRel}\n`;
  if (excerpt) fm += `excerpt: ${excerpt}\n`;
  fm += "---\n\n";

  let text = body || "";
  let idx = 0;
  text = text.replace(/\[图(?::([^\]]*))?\]/g, (_match, desc) => {
    if (idx < imageRels.length) {
      const alt = desc ? desc.trim() : "";
      return `![${alt}](${imageRels[idx++]})\n`;
    }
    return "";
  });
  const rest = imageRels.slice(idx).map((r) => `![](${r})`).join("\n\n");
  const content = [text.trim(), rest].filter(Boolean).join("\n\n");

  return fm + content + "\n";
}

// 提取正文里的图片路径（originals/xxx）
function extractImages(body) {
  return [...body.matchAll(/!\[[^\]]*\]\((originals\/[^)]+)\)/g)].map((m) => m[1]);
}

// 把正文里的图片还原成 [图] 或 [图:说明] 占位符，方便编辑
function bodyToPlaceholders(body) {
  return body.replace(/!\[([^\]]*)\]\((originals\/[^)]+)\)/g, (_m, alt) => {
    return alt ? `[图:${alt}]` : `[图]`;
  });
}

// ---------- API ----------

app.get("/api/issues", (_req, res) => {
  res.json(listIssues());
});

app.post("/api/issues", (req, res) => {
  const { number, title, subtitle = "", date = "", intro = "" } = req.body || {};
  if (!number || !title) return res.status(400).json({ error: "期号和标题必填" });
  if (findIssueDir(number)) return res.status(400).json({ error: `第 ${number} 期已存在` });

  const dirName = `${number}-${safeName(title) || "未命名"}`;
  const dir = path.join(ISSUES_DIR, dirName);
  fs.mkdirSync(path.join(dir, "originals"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "issue.json"),
    JSON.stringify({ number, title, subtitle, date, intro, cover: "" }, null, 2)
  );
  res.json({ ok: true, dirName });
});

app.get("/api/issues/:number/articles", (req, res) => {
  const dirName = findIssueDir(req.params.number);
  if (!dirName) return res.status(404).json({ error: "期不存在" });
  const dir = path.join(ISSUES_DIR, dirName);

  const articles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      const { data } = parseFrontmatter(raw);
      return {
        order: f.match(/^(\d+)/)?.[1] || "",
        file: f,
        title: data.title || f,
        section: data.section || "",
        date: data.date || "",
        excerpt: data.excerpt || "",
        cover: data.cover || "",
      };
    });
  res.json(articles);
});

app.post(
  "/api/articles",
  upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "images", maxCount: 30 },
  ]),
  (req, res) => {
    try {
      const { issueNumber, title, section, date, excerpt, body } = req.body;
      if (!issueNumber || !title) return res.status(400).json({ error: "期号和标题必填" });

      const dirName = findIssueDir(issueNumber);
      if (!dirName) return res.status(404).json({ error: "期不存在" });
      const dir = path.join(ISSUES_DIR, dirName);
      const originalsDir = path.join(dir, "originals");

      const existing = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
      const order = String(existing.length + 1).padStart(2, "0");

      const coverFile = req.files?.cover?.[0];
      let coverRel = "";
      if (coverFile) {
        const ext = (path.extname(coverFile.originalname) || ".jpg").toLowerCase();
        const name = `cover-${order}${ext}`;
        fs.copyFileSync(coverFile.path, path.join(originalsDir, name));
        fs.unlinkSync(coverFile.path);
        coverRel = `originals/${name}`;
      }

      const imageFiles = req.files?.images || [];
      const imageRels = imageFiles.map((f, i) => {
        const ext = (path.extname(f.originalname) || ".jpg").toLowerCase();
        const name = `${order}-${i + 1}${ext}`;
        fs.copyFileSync(f.path, path.join(originalsDir, name));
        fs.unlinkSync(f.path);
        return `originals/${name}`;
      });

      const md = buildMarkdown({ title, section, date, excerpt, body, coverRel, imageRels });
      const fileName = `${order}-${safeName(title) || "文章"}.md`;
      fs.writeFileSync(path.join(dir, fileName), md);

      res.json({ ok: true, file: fileName, order });
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
  }
);

app.get("/api/issues/:number/articles/:file", (req, res) => {
  const dirName = findIssueDir(req.params.number);
  if (!dirName) return res.status(404).json({ error: "期不存在" });

  const file = req.params.file;
  if (!/^\d+-.+\.md$/.test(file)) return res.status(400).json({ error: "文件名非法" });
  const full = path.join(ISSUES_DIR, dirName, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "文章不存在" });

  const raw = fs.readFileSync(full, "utf8");
  const { data, body } = parseFrontmatter(raw);
  res.json({
    file,
    order: file.match(/^(\d+)/)?.[1] || "",
    title: data.title || "",
    section: data.section || "",
    date: data.date || "",
    excerpt: data.excerpt || "",
    cover: data.cover || "",
    body: bodyToPlaceholders(body),
    imageCount: extractImages(body).length,
  });
});

app.put(
  "/api/issues/:number/articles/:file",
  upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "images", maxCount: 30 },
  ]),
  (req, res) => {
    try {
      const { number, file } = req.params;
      const { title, section, date, excerpt, body } = req.body;
      if (!title) return res.status(400).json({ error: "标题必填" });

      const dirName = findIssueDir(number);
      if (!dirName) return res.status(404).json({ error: "期不存在" });
      const full = path.join(ISSUES_DIR, dirName, file);
      if (!/^\d+-.+\.md$/.test(file) || !fs.existsSync(full)) {
        return res.status(404).json({ error: "文章不存在" });
      }
      const dir = path.join(ISSUES_DIR, dirName);
      const originalsDir = path.join(dir, "originals");
      const order = file.match(/^(\d+)/)?.[1] || "00";

      const raw = fs.readFileSync(full, "utf8");
      const { data: oldData, body: oldBody } = parseFrontmatter(raw);
      const existingImages = extractImages(oldBody);

      let coverRel = oldData.cover || "";
      const coverFile = req.files?.cover?.[0];
      if (coverFile) {
        const ext = (path.extname(coverFile.originalname) || ".jpg").toLowerCase();
        const name = `cover-${order}${ext}`;
        fs.copyFileSync(coverFile.path, path.join(originalsDir, name));
        fs.unlinkSync(coverFile.path);
        coverRel = `originals/${name}`;
      }

      const imageFiles = req.files?.images || [];
      const newImageRels = imageFiles.map((f, i) => {
        const ext = (path.extname(f.originalname) || ".jpg").toLowerCase();
        const name = `${order}-${Date.now()}-${i}${ext}`;
        fs.copyFileSync(f.path, path.join(originalsDir, name));
        fs.unlinkSync(f.path);
        return `originals/${name}`;
      });

      const allImages = [...existingImages, ...newImageRels];
      const md = buildMarkdown({ title, section, date, excerpt, body, coverRel, imageRels: allImages });
      fs.writeFileSync(full, md);

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
  }
);

app.delete("/api/issues/:number/articles/:file", (req, res) => {
  const dirName = findIssueDir(req.params.number);
  if (!dirName) return res.status(404).json({ error: "期不存在" });

  const file = req.params.file;
  if (!/^\d+-.+\.md$/.test(file)) return res.status(400).json({ error: "文件名非法" });
  const full = path.join(ISSUES_DIR, dirName, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "文章不存在" });

  fs.unlinkSync(full);
  res.json({ ok: true });
});

app.post("/api/build", (_req, res) => {
  try {
    execSync("node build.js", { cwd: ROOT, stdio: "pipe" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.stderr || err.message || err) });
  }
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: String(err.message || err) });
});

app.listen(PORT, () => {
  console.log(`管理端已启动：http://localhost:${PORT}`);
});
