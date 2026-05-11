import { mkdir, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const contentDir = join(root, "content");
const distDir = join(root, "dist");
const geistFontsDir = join(root, "node_modules/geist/dist/fonts");

const args = new Set(process.argv.slice(2));

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkAttrs(href = "") {
  return /^https?:\/\//i.test(String(href)) ? ' target="_blank" rel="noreferrer"' : "";
}

function inlineMarkdown(value = "") {
  return escapeHtml(value)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => `<a href="${href}"${linkAttrs(href)}>${label}</a>`);
}

function markdownToHtml(markdown = "") {
  const lines = markdown.trim().split(/\r?\n/);
  let html = "";
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      const level = heading[1].length + 1;
      html += `<h${level}>${inlineMarkdown(heading[2])}</h${level}>`;
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inlineMarkdown(bullet[1])}</li>`;
      continue;
    }

    if (inList) {
      html += "</ul>";
      inList = false;
    }
    html += `<p>${inlineMarkdown(line)}</p>`;
  }

  if (inList) html += "</ul>";
  return html;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "{}") return {};
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(source) {
  if (!source.startsWith("---")) return [{}, source];
  const end = source.indexOf("\n---", 3);
  if (end === -1) return [{}, source];
  const yaml = source.slice(3, end).trim().split(/\r?\n/);
  const body = source.slice(end + 4).trim();
  const data = {};
  let currentKey = null;

  for (const line of yaml) {
    if (!line.trim()) continue;
    const nested = /^  ([^:]+):\s*(.*)$/.exec(line);
    const listItem = /^  -\s*(.+)$/.exec(line);
    const pair = /^([^:]+):\s*(.*)$/.exec(line);

    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(parseScalar(listItem[1]));
      continue;
    }

    if (nested && currentKey) {
      if (!data[currentKey] || Array.isArray(data[currentKey])) data[currentKey] = {};
      data[currentKey][nested[1].trim()] = parseScalar(nested[2]);
      continue;
    }

    if (pair) {
      currentKey = pair[1].trim();
      const value = pair[2];
      data[currentKey] = value === "" ? undefined : parseScalar(value);
    }
  }

  return [data, body];
}

async function readEntries(section) {
  const dir = join(contentDir, section);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".md"));
  const entries = [];

  for (const name of names) {
    const source = await readFile(join(dir, name), "utf8");
    const [data, body] = parseFrontmatter(source);
    if (data.draft) continue;
    const slug = name.replace(/\.md$/, "");
    entries.push({
      ...data,
      slug,
      section,
      body,
      bodyHtml: markdownToHtml(body),
      url: `${section}/${slug}.html`,
    });
  }

  return entries.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

async function readPage(name) {
  const source = await readFile(join(contentDir, `${name}.md`), "utf8");
  const [data, body] = parseFrontmatter(source);
  return {
    ...data,
    slug: name,
    body,
    bodyHtml: markdownToHtml(body),
  };
}

function metaLine(entry) {
  return [entry.composer, entry.date, entry.place || entry.location, entry.type]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" / ");
}

function linkList(links, className = "links-row") {
  if (!links) return "";
  const items = Array.isArray(links)
    ? links.map((href) => [href, href])
    : Object.entries(links);
  const filtered = items.filter(([, href]) => href);
  if (!filtered.length) return "";
  return `<div class="${className}">${filtered
    .map(([label, href]) => `<a href="${escapeHtml(href)}"${linkAttrs(href)}>${escapeHtml(label)}</a>`)
    .join("")}</div>`;
}

function isYouTubeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

function nonYouTubeLinks(links) {
  if (!Array.isArray(links)) return links;
  return links.filter((href) => !isYouTubeUrl(href));
}

function youtubeEmbedGrid(urls = []) {
  const ids = [...new Set(urls.map(extractYouTubeId).filter(Boolean))];
  if (!ids.length) return "";
  return `<section class="youtube-grid" aria-label="Demo videos">
    ${ids.map((id) => `<iframe src="https://www.youtube.com/embed/${escapeHtml(id)}" title="Demo video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`).join("")}
  </section>`;
}

function valueList(title, values) {
  if (!values) return "";
  const list = Array.isArray(values) ? values : [values];
  if (!list.length) return "";
  return `<section class="entry-note">
    <h3>${escapeHtml(title)}</h3>
    <ul>${list.map((value) => `<li>${inlineMarkdown(value)}</li>`).join("")}</ul>
  </section>`;
}

function chips(values) {
  if (!values) return "";
  const list = Array.isArray(values) ? values : [values];
  return `<div class="chips">${list.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>`;
}

function card(entry) {
  return `<article class="card ${entry.featured ? "featured" : ""}">
    <a class="card-link" href="${entry.url}">
      <span class="kicker">${escapeHtml(entry.type || entry.status || entry.section)}</span>
      <h3>${escapeHtml(entry.title)}</h3>
      ${metaLine(entry) ? `<p class="meta">${metaLine(entry)}</p>` : ""}
      <p>${escapeHtml(entry.summary || entry.body.split(/\n/)[0] || "")}</p>
      ${chips(entry.technologies || entry.tool)}
    </a>
  </article>`;
}

function cardGrid(entries) {
  return entries.map(card).join("");
}

function mediaEmbed(entry) {
  const media = entry.media || "";
  if (!media) return "";
  const youtubeId = extractYouTubeId(media);
  if (youtubeId) {
    return `<iframe class="youtube-embed" src="https://www.youtube.com/embed/${escapeHtml(youtubeId)}" title="${escapeHtml(entry.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  }
  if (/\.mp4$/i.test(media)) {
    const src = media.startsWith("Notion/")
      ? `/assets/${media.split("/").map(encodeURIComponent).join("/")}`
      : media;
    return `<video controls preload="metadata" src="${src}"></video>`;
  }
  return `<a class="media-link" href="${escapeHtml(media)}"${linkAttrs(media)}>${escapeHtml(media)}</a>`;
}

function extractYouTubeId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname === "/watch") return parsed.searchParams.get("v") || "";
      if (parsed.pathname.startsWith("/embed/")) return parsed.pathname.split("/")[2] || "";
      if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2] || "";
    }
  } catch {
    return "";
  }
  return "";
}

function youtubeEmbeds(entry) {
  if (entry.section !== "works") return "";
  const bodyUrls = String(entry.body || "").match(/https?:\/\/[^\s)]+/g) || [];
  const values = [
    ...(Array.isArray(entry.files) ? entry.files : []),
    ...bodyUrls,
  ];
  const ids = [...new Set(values.map(extractYouTubeId).filter(Boolean))];
  if (!ids.length) return "";
  return `<section class="youtube-grid" aria-label="YouTube videos">
    ${ids.map((id) => `<iframe src="https://www.youtube.com/embed/${escapeHtml(id)}" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`).join("")}
  </section>`;
}

function personCard(entry) {
  return `<article class="person-card">
    <div class="person-copy">
      <h3>${escapeHtml(entry.title)}</h3>
      ${entry.role ? `<p class="meta">${escapeHtml(entry.role)}</p>` : ""}
      ${entry.bodyHtml ? `<div class="person-bio">${entry.bodyHtml}</div>` : ""}
      ${linkList(entry.links)}
    </div>
  </article>`;
}

function peopleGrid(entries) {
  return `<div class="people-grid">${entries.map(personCard).join("")}</div>`;
}

const siteTitle = "Nils Demerlé";

const categoryPages = {
  research: "research.html",
  projects: "projects.html",
  media: "media.html",
  teaching: "teaching.html",
};

function navId(section = "") {
  if (section === "works") return "projects";
  if (section === "tech") return "research";
  return section;
}

function sectionAnchor(section = "") {
  return navId(section);
}

function sectionLabel(section = "") {
  if (section === "works") return "projects";
  if (section === "tech") return "research";
  return section;
}

function mainNav(current = "") {
  const itemClass = (id) => (current === id ? "nav-item active" : "nav-item");
  const legendLink = (id, href, label) => `<a class="legend-link" href="${href}"${current === id ? ' aria-current="page"' : ""}>
      <span class="legend-symbol legend-${id}" aria-hidden="true"></span>
      <span>${label}</span>
    </a>`;
  return `<nav class="main-nav" aria-label="Main navigation">
    <span class="legend-title">Map key</span>
    <div class="${itemClass("research")}">
      ${legendLink("research", "/research.html", "Research")}
      <div class="submenu">
        <a href="/research.html#technologies">Technologies</a>
        <a href="/research.html#publications">List of publications</a>
      </div>
    </div>
    <div class="${itemClass("projects")}">
      ${legendLink("projects", "/projects.html", "Projects")}
      <div class="submenu">
        <a href="/projects.html">Artistic collaborations</a>
      </div>
    </div>
    <div class="${itemClass("media")}">${legendLink("media", "/media.html", "Medias")}</div>
    <div class="${itemClass("teaching")}">${legendLink("teaching", "/teaching.html", "Teaching")}</div>
  </nav>`;
}

function pageShell({ title, description, body, current = "", siteTitle: titleInHeader = siteTitle }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description || "ACIDS")}" />
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/"><span>${escapeHtml(titleInHeader)}</span></a>
  </header>
  ${mainNav(current)}
  ${body}
</body>
</html>`;
}

function entryArticle(entry) {
  const demoUrls = [
    ...(Array.isArray(entry.demos) ? entry.demos : []),
    ...(!entry.demos && entry.demo ? [entry.demo] : []),
  ];
  return `<article class="entry-block" id="${escapeHtml(entry.slug)}">
    <p class="kicker">${escapeHtml(entry.type || entry.section)}</p>
    <h2>${escapeHtml(entry.title)}</h2>
    ${metaLine(entry) ? `<p class="lead meta">${metaLine(entry)}</p>` : ""}
    ${chips(entry.technologies || entry.tool)}
    <section class="prose">${entry.bodyHtml}</section>
    ${mediaEmbed(entry)}
    ${youtubeEmbedGrid(demoUrls)}
    ${youtubeEmbeds(entry)}
    ${valueList("Used by", entry.used_by)}
    ${linkList(entry.links || nonYouTubeLinks(entry.files))}
  </article>`;
}

function categoryPage({ title, kicker, description, current, introHtml = "", entries = [] }) {
  const body = `<main class="category">
    <header class="category-head">
      <p class="kicker">${escapeHtml(kicker)}</p>
      <h1>${escapeHtml(title)}</h1>
      ${description ? `<p class="category-summary">${escapeHtml(description)}</p>` : ""}
      ${introHtml ? `<div class="press-prose">${introHtml}</div>` : ""}
    </header>
    <div class="entry-list">
      ${entries.map(entryArticle).join("")}
    </div>
  </main>`;

  return pageShell({ title: `${title} / ${siteTitle}`, description, body, current });
}

function researchPage({ academicResearch, tech }) {
  const body = `<main class="category">
    <header class="category-head">
      <p class="kicker">Research</p>
      <h1>Research</h1>
      <p class="category-summary">Technologies, software contributions, demo material, references, and formal publications.</p>
    </header>
    <section id="technologies" class="entry-list">
      ${tech.map(entryArticle).join("")}
    </section>
    <section id="publications" class="entry-block publications-block">
      <p class="kicker">Publications</p>
      <h2>List of publications</h2>
      <div class="prose">${academicResearch.bodyHtml}</div>
    </section>
  </main>`;

  return pageShell({
    title: `Research / ${siteTitle}`,
    description: "Technologies, software contributions, demo material, references, and formal publications.",
    body,
    current: "research",
  });
}

async function copyDir(sourceDir, targetDir) {
  let entries = [];
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }

  await mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(source, target);
    } else if (entry.isFile()) {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  }
}

async function copyGeistFonts() {
  const targetDir = join(distDir, "assets/generated/fonts");
  await mkdir(targetDir, { recursive: true });
  await Promise.all([
    copyFile(join(geistFontsDir, "geist-sans/Geist-Variable.woff2"), join(targetDir, "Geist-Variable.woff2")),
    copyFile(join(geistFontsDir, "geist-mono/GeistMono-Variable.woff2"), join(targetDir, "GeistMono-Variable.woff2")),
    copyFile(join(geistFontsDir, "geist-pixel/GeistPixel-Square.woff2"), join(targetDir, "GeistPixel-Square.woff2")),
    copyFile(join(geistFontsDir, "geist-pixel/GeistPixel-Grid.woff2"), join(targetDir, "GeistPixel-Grid.woff2")),
    copyFile(join(geistFontsDir, "geist-pixel/GeistPixel-Circle.woff2"), join(targetDir, "GeistPixel-Circle.woff2")),
    copyFile(join(geistFontsDir, "geist-pixel/GeistPixel-Triangle.woff2"), join(targetDir, "GeistPixel-Triangle.woff2")),
    copyFile(join(geistFontsDir, "geist-pixel/GeistPixel-Line.woff2"), join(targetDir, "GeistPixel-Line.woff2")),
  ]);
}

function fade(value) {
  return value * value * (3 - 2 * value);
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function hash2(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function valueNoise(x, y, scale) {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = fade(gx - x0);
  const ty = fade(gy - y0);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return mix(mix(a, b, tx), mix(c, d, tx), ty) * 2 - 1;
}

function terrainValue(x, y) {
  const peaks = [
    [250, 720, 210, 0.92],
    [1520, 960, 190, 1.1],
    [1380, 1740, 230, 1.22],
    [420, 2820, 180, 0.9],
    [1180, 3840, 260, 1.05],
    [220, 5200, 230, 0.98],
    [1430, 6100, 210, 1.15],
    [760, 6800, 180, 0.82],
    [1680, 7050, 260, 1.0],
    [1320, 520, 78, 0.28],
    [250, 1320, 62, 0.24],
    [1540, 2460, 70, 0.32],
    [510, 3340, 58, 0.24],
    [1180, 4920, 64, 0.28],
    [310, 6040, 70, 0.26],
    [1480, 6900, 54, 0.24],
  ];
  const ridges = [
    [940, 0, 0.00005, 0.3],
    [620, 2500, 0.00004, 0.24],
    [1120, 4600, 0.000035, 0.22],
  ];
  let value = -0.22;

  for (const [cx, cy, radius, strength] of peaks) {
    const dx = x - cx;
    const dy = y - cy;
    value += Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius)) * strength;
  }

  for (const [cx, cy, falloff, strength] of ridges) {
    const ridgeX = cx + Math.sin((y + cy) * 0.003) * 150;
    value += Math.exp(-Math.abs(x - ridgeX) * Math.abs(x - ridgeX) * falloff) * strength;
  }

  value += valueNoise(x, y, 240) * 0.095;
  value += valueNoise(x + 400, y - 900, 120) * 0.04;
  value += valueNoise(x - 180, y + 300, 72) * 0.014;
  value += valueNoise(x + 1000, y + 1400, 42) * 0.004;
  value += Math.sin(x * 0.021 + y * 0.009) * 0.017;
  value += Math.sin(x * 0.034 - y * 0.013 + 2.1) * 0.006;
  return value;
}

function contourSegment(x, y, size, values, level) {
  const points = [
    [x + size * ((level - values[0]) / (values[1] - values[0])), y],
    [x + size, y + size * ((level - values[1]) / (values[2] - values[1]))],
    [x + size * ((level - values[3]) / (values[2] - values[3])), y + size],
    [x, y + size * ((level - values[0]) / (values[3] - values[0]))],
  ];
  const edges = [
    values[0] < level !== values[1] < level,
    values[1] < level !== values[2] < level,
    values[3] < level !== values[2] < level,
    values[0] < level !== values[3] < level,
  ];
  const active = points.filter((_, index) => edges[index]);
  if (active.length < 2) return "";
  if (active.length === 4) {
    return `M${active[0][0].toFixed(1)} ${active[0][1].toFixed(1)}L${active[1][0].toFixed(1)} ${active[1][1].toFixed(1)}M${active[2][0].toFixed(1)} ${active[2][1].toFixed(1)}L${active[3][0].toFixed(1)} ${active[3][1].toFixed(1)}`;
  }
  return `M${active[0][0].toFixed(1)} ${active[0][1].toFixed(1)}L${active[1][0].toFixed(1)} ${active[1][1].toFixed(1)}`;
}

function topographySvg() {
  const width = 1800;
  const height = 7200;
  const size = 12;
  const levels = [0.16, 0.24, 0.31, 0.39, 0.5, 0.58, 0.67, 0.79, 0.88, 0.99, 1.13];
  const lines = [];
  const grid = [];

  for (let x = 0, index = 0; x <= width; x += 120, index += 1) {
    grid.push(`<path d="M${x} 0V${height}"${index % 2 === 1 ? ' stroke-dasharray="14 18"' : ""}/>`);
  }
  for (let y = 0, index = 0; y <= height; y += 120, index += 1) {
    grid.push(`<path d="M0 ${y}H${width}"${index % 2 === 1 ? ' stroke-dasharray="14 18"' : ""}/>`);
  }

  for (const level of levels) {
    const segments = [];
    for (let y = -size; y < height + size; y += size) {
      for (let x = -size; x < width + size; x += size) {
        const values = [
          terrainValue(x, y),
          terrainValue(x + size, y),
          terrainValue(x + size, y + size),
          terrainValue(x, y + size),
        ];
        const segment = contourSegment(x, y, size, values, level);
        if (segment) segments.push(segment);
      }
    }
    const index = levels.indexOf(level);
    const opacity = (0.09 + index * 0.012).toFixed(3);
    const strokeWidth = (0.85 + index * 0.07).toFixed(2);
    lines.push(`<path d="${segments.join("")}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`); 
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <filter id="hand-drawn" x="-2%" y="-2%" width="104%" height="104%">
      <feTurbulence type="fractalNoise" baseFrequency="0.018 0.031" numOctaves="2" seed="11" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <g fill="none" stroke="#050505" stroke-width="1.05" opacity="0.105">
    ${grid.join("\n    ")}
  </g>
  <g fill="none" stroke="#050505" stroke-linecap="round" stroke-linejoin="round" filter="url(#hand-drawn)">
    ${lines.join("\n    ")}
  </g>
</svg>`;
}

function paperGrainSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
  <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" seed="19"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer>
      <feFuncA type="table" tableValues="0 0.24"/>
    </feComponentTransfer>
  </filter>
  <rect width="220" height="220" filter="url(#grain)" opacity="0.32"/>
</svg>`;
}

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const siteSource = await readFile(join(contentDir, "site.md"), "utf8");
  const [site, siteBody] = parseFrontmatter(siteSource);
  const [works, tech, media, academicResearch, teachingConfs] = await Promise.all([
    readEntries("works"),
    readEntries("tech"),
    readEntries("media"),
    readPage("academic-research"),
    readPage("teaching-confs"),
  ]);
  const techOrder = ["rave", "after", "nn", "torchbend", "flowsynth", "junk", "ravetable"];
  tech.sort((a, b) => techOrder.indexOf(a.slug) - techOrder.indexOf(b.slug));

  await copyDir(join(root, "assets"), join(distDir, "assets"));
  await mkdir(join(distDir, "assets/generated"), { recursive: true });
  await copyGeistFonts();
  await writeFile(join(distDir, "assets/generated/topography.svg"), topographySvg(), "utf8");
  await writeFile(join(distDir, "assets/generated/paper-grain.svg"), paperGrainSvg(), "utf8");
  await writeFile(join(distDir, "styles.css"), css, "utf8");

  await writeFile(join(distDir, categoryPages.research), researchPage({ academicResearch, tech }), "utf8");
  await writeFile(join(distDir, categoryPages.projects), categoryPage({
    title: "Projects",
    kicker: "Projects",
    description: "Artistic collaborations, performances, documentation, videos, and related links.",
    current: "projects",
    entries: works,
  }), "utf8");
  await writeFile(join(distDir, categoryPages.media), categoryPage({
    title: "Media",
    kicker: "Media",
    description: "Videos, tutorials, and media documentation.",
    current: "media",
    entries: media,
  }), "utf8");
  await writeFile(join(distDir, categoryPages.teaching), categoryPage({
    title: "Teaching",
    kicker: "Teaching",
    description: "Courses, conferences, and teaching material.",
    current: "teaching",
    introHtml: teachingConfs.bodyHtml,
  }), "utf8");

  const intro = markdownToHtml(siteBody);
  const portrait = site.portrait
    ? `<img src="${escapeHtml(site.portrait)}" alt="${escapeHtml(site.title || "Portrait")}">`
    : `<div class="portrait-placeholder">Portrait image</div>`;
  const body = `<main>
    <section class="hero">
      <div class="hero-copy">
        <div class="hero-grid">
          <figure class="portrait-slot">${portrait}</figure>
          <div>
            <p class="kicker">Personal website</p>
            <h1>${escapeHtml(site.tagline || site.title)}</h1>
            <div class="lead">${intro}</div>
            ${linkList(site.links, "links-row hero-links")}
          </div>
        </div>
      </div>
    </section>
  </main>`;

  await writeFile(join(distDir, "index.html"), pageShell({
    title: site.title || "Nils Demerlé",
    description: site.summary,
    body,
    siteTitle: site.title || "Nils Demerlé",
  }), "utf8");
}

const css = `
@font-face {
  font-family: "Geist Sans";
  src: url("/assets/generated/fonts/Geist-Variable.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Geist Mono";
  src: url("/assets/generated/fonts/GeistMono-Variable.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Geist Pixel Square";
  src: url("/assets/generated/fonts/GeistPixel-Square.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Geist Pixel Grid";
  src: url("/assets/generated/fonts/GeistPixel-Grid.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Geist Pixel Circle";
  src: url("/assets/generated/fonts/GeistPixel-Circle.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Geist Pixel Triangle";
  src: url("/assets/generated/fonts/GeistPixel-Triangle.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Geist Pixel Line";
  src: url("/assets/generated/fonts/GeistPixel-Line.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

:root {
  --ink: #050505;
  --muted: #515151;
  --paper: #ffffff;
  --line: #050505;
  --soft: #f4f4f4;
  --acid: #b6ff00;
  --red: #ff4b4b;
  --blue: #2248ff;
  --grid: rgba(5, 5, 5, 0.028);
  --grid-strong: rgba(5, 5, 5, 0.045);
  --font-body: "Avenir Next", "Inter", "Helvetica Neue", Arial, sans-serif;
  --font-display: "Avenir Next Condensed", "DIN Condensed", "Helvetica Neue", Arial, sans-serif;
  --font-title: "Geist Mono", "Avenir Next Condensed", "DIN Condensed", sans-serif;
  --font-mono: "Geist Mono", "SFMono-Regular", Consolas, monospace;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--ink);
  background-image: url("/assets/generated/topography.svg");
  background-color: var(--paper);
  background-position: center top;
  background-repeat: no-repeat;
  background-size: min(1800px, 170vw) auto;
  background-attachment: scroll;
  font-family: var(--font-body);
  line-height: 1.45;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 1000;
  pointer-events: none;
  background-image: url("/assets/generated/paper-grain.svg");
  background-size: 220px 220px;
  opacity: 0.14;
  mix-blend-mode: multiply;
}
a { color: inherit; text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  padding: 0.85rem clamp(1rem, 3vw, 2rem);
  background: color-mix(in srgb, #ecece7 92%, transparent);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(12px);
}
.brand {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  text-decoration: none;
}
.brand img {
  width: 4.5rem;
  height: auto;
}
.brand span {
  font-family: var(--font-title);
  font-weight: 300;
  letter-spacing: 0;
}
.main-nav {
  position: fixed;
  right: clamp(1rem, 3vw, 2rem);
  bottom: clamp(1rem, 3vw, 2rem);
  z-index: 30;
  display: grid;
  width: min(14rem, calc(100vw - 2rem));
  padding: 0.45rem;
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  border: 1.5px solid var(--ink);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 28%, transparent);
  backdrop-filter: blur(12px);
}
.legend-title {
  padding: 0.1rem 0.25rem 0.5rem;
  color: var(--ink);
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
  border-bottom: 1px solid var(--ink);
}
.nav-item {
  position: relative;
}
.legend-link {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  width: 100%;
  min-height: 2rem;
  padding: 0.44rem 0.3rem;
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1;
  text-decoration: none;
}
.nav-item:hover .legend-link,
.nav-item.active .legend-link {
  color: var(--ink);
  background:
    linear-gradient(90deg, rgba(5, 5, 5, 0.045) 1px, transparent 1px),
    linear-gradient(180deg, rgba(5, 5, 5, 0.045) 1px, transparent 1px);
  background-size: 8px 8px;
  box-shadow: inset 0 0 0 1px var(--ink);
}
.legend-symbol {
  position: relative;
  display: inline-grid;
  flex: 0 0 auto;
  width: 1.15rem;
  height: 1.15rem;
  place-items: center;
  color: var(--ink);
}
.legend-symbol::before,
.legend-symbol::after {
  content: "";
  display: block;
}
.legend-research::before {
  width: 1.08rem;
  height: 0.72rem;
  border: 1.5px solid currentColor;
  border-left-color: transparent;
  border-radius: 52% 48% 45% 55%;
  transform: rotate(-18deg);
}
.legend-research::after {
  position: absolute;
  width: 0.48rem;
  height: 0.3rem;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  transform: rotate(-18deg);
}
.legend-projects::before {
  width: 0.76rem;
  height: 0.76rem;
  border: 1.5px solid currentColor;
  transform: rotate(45deg);
}
.legend-projects::after {
  position: absolute;
  width: 0.24rem;
  height: 0.24rem;
  background: currentColor;
}
.legend-media::before {
  width: 1rem;
  height: 0.72rem;
  border: 1.5px solid currentColor;
}
.legend-media::after {
  position: absolute;
  width: 0;
  height: 0;
  border-top: 0.23rem solid transparent;
  border-bottom: 0.23rem solid transparent;
  border-left: 0.36rem solid currentColor;
  transform: translateX(0.05rem);
}
.legend-teaching::before {
  width: 0.68rem;
  height: 0.68rem;
  border: 1.5px solid currentColor;
  border-radius: 50%;
}
.legend-teaching::after {
  position: absolute;
  bottom: 0.05rem;
  width: 0.48rem;
  height: 1.08rem;
  border-left: 1.5px solid currentColor;
  transform: rotate(32deg);
  transform-origin: bottom center;
}
.submenu {
  position: static;
  z-index: 20;
  display: none;
  margin: 0 0 0.3rem 1.58rem;
  padding: 0.28rem 0 0.2rem 0.45rem;
  background: transparent;
  border-left: 1px solid var(--ink);
}
.nav-item:hover .submenu,
.nav-item:focus-within .submenu {
  display: grid;
  gap: 0.2rem;
}
.submenu a,
.submenu span {
  display: block;
  padding: 0.35rem 0.45rem;
  color: var(--ink);
  text-decoration: none;
  white-space: nowrap;
}
.submenu a:hover {
  background: #ecece7;
}
.submenu span {
  color: var(--muted);
}
main { width: min(1200px, calc(100% - 2rem)); margin: 0 auto; }
.hero {
  position: relative;
  min-height: calc(100vh - 4rem);
  display: flex;
  align-items: center;
  padding: clamp(3rem, 8vw, 6rem) 0;
  overflow: hidden;
}
.hero-copy {
  width: min(100%, 1040px);
}
.hero-grid {
  display: grid;
  grid-template-columns: minmax(220px, 340px) minmax(0, 1fr);
  gap: clamp(1.5rem, 4vw, 4rem);
  align-items: center;
}
.hero-title-lockup {
  display: grid;
  grid-template-columns: clamp(96px, 13vw, 170px) minmax(0, auto);
  align-items: center;
  gap: clamp(1rem, 2.8vw, 2.5rem);
  margin-bottom: clamp(1.2rem, 3vw, 2.4rem);
}
.hero-mark {
  margin: 0;
}
.hero-mark img {
  display: block;
  width: 100%;
  height: auto;
}
.portrait-slot {
  margin: 0;
  aspect-ratio: 4 / 5;
  background: var(--soft);
  border: 1px solid var(--ink);
  overflow: hidden;
}
.portrait-slot img,
.portrait-placeholder {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
}
.portrait-slot img {
  object-fit: cover;
}
.portrait-placeholder {
  padding: 1rem;
  color: var(--muted);
  font-weight: 700;
  text-align: center;
  text-transform: uppercase;
}
.kicker {
  display: none;
}
h1, h2, h3 { line-height: 1.02; letter-spacing: 0; }
h1, h2, h3 { font-family: var(--font-display); font-weight: 800; }
h1 {
  margin: 0;
  font-size: clamp(3.5rem, 10vw, 9rem);
  text-transform: uppercase;
}
.hero h1 {
  font-family: var(--font-title);
  font-weight: 400;
}
h2 { margin: 0; font-size: clamp(1.8rem, 4vw, 3.7rem); max-width: none; }
h3 { margin: 0.5rem 0; font-size: 1.25rem; }
.lead {
  max-width: 66ch;
  margin-top: 1.25rem;
  font-size: clamp(0.98rem, 1.08vw, 1.12rem);
  color: var(--ink);
}
.lead p { margin: 0 0 1rem; }
.hero-links {
  margin-top: 1.5rem;
}
section { padding: clamp(3rem, 7vw, 6rem) 0; }
.band {
  width: 100vw;
  margin-left: calc(50% - 50vw);
  padding-left: max(1rem, calc((100vw - 1200px) / 2));
  padding-right: max(1rem, calc((100vw - 1200px) / 2));
  background: color-mix(in srgb, var(--soft) 86%, transparent);
  border-block: 1px solid var(--line);
}
.section-head {
  display: block;
  margin-bottom: 1.3rem;
}
.section-head h2 {
  white-space: nowrap;
}
.align-left .section-head {
  text-align: left;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  background: transparent;
  border: 0;
}
.grid.compact { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.card {
  min-height: 260px;
  background: var(--paper);
  border: 1px solid var(--ink);
  margin: 0 -1px -1px 0;
}
.card.featured { background: var(--paper); }
.card-link {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding: 1rem;
  text-decoration: none;
}
.card p { color: var(--muted); margin: 0.6rem 0; }
.card .meta { color: var(--ink); font-size: 0.86rem; }
.chips {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 1rem;
}
.chips span {
  padding: 0.18rem 0.42rem;
  border: 1px solid var(--ink);
  background: var(--acid);
  font-size: 0.76rem;
}
.links-row {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 1.25rem;
}
.links-row a,
.links-row span {
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--ink);
  background: var(--paper);
  text-decoration: none;
}
.links-row a:hover { background: #ecece7; }
.links-row span {
  color: var(--muted);
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.category {
  max-width: 980px;
  padding: clamp(3rem, 7vw, 6rem) 0;
}
.category-head {
  margin-bottom: clamp(2rem, 5vw, 4rem);
}
.category-head h1 {
  max-width: 12ch;
}
.category-summary {
  max-width: 62ch;
  margin: 1rem 0 0;
  color: var(--muted);
  font-size: clamp(1.05rem, 1.4vw, 1.25rem);
}
.entry-list {
  display: grid;
  gap: clamp(2.5rem, 6vw, 5rem);
}
.entry-block {
  padding: clamp(1.5rem, 4vw, 3rem) 0;
}
.entry-block h2 {
  white-space: normal;
}
.entry-block .lead {
  max-width: 100%;
  margin-top: 0.5rem;
}
.entry-block .chips {
  width: fit-content;
  margin-top: 0.9rem;
  padding-top: 0;
}
.entry-block .links-row {
  margin-top: 1rem;
}
.entry-note {
  max-width: 68ch;
  margin-top: 1rem;
}
.entry-note h3 {
  margin: 0 0 0.5rem;
  font-family: var(--font-body);
  font-size: 0.95rem;
  text-transform: uppercase;
}
.entry-note ul {
  margin: 0;
  padding-left: 1.2rem;
}
.publications-block {
  margin-top: clamp(2rem, 5vw, 4rem);
}
.media-card {
  border-top: 1px solid var(--ink);
  padding-top: 0.75rem;
  background: color-mix(in srgb, var(--paper) 68%, transparent);
}
.youtube-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
  padding: 0;
}
.youtube-grid::before { display: none; }
.youtube-grid iframe,
.youtube-embed {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--ink);
  background: #000;
}
video {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #111;
  display: block;
  border: 1px solid var(--ink);
}
.detail {
  max-width: 860px;
  padding: clamp(3rem, 7vw, 6rem) 0;
}
.detail h1 { max-width: 14ch; font-size: clamp(3rem, 8vw, 7rem); }
.back { display: inline-block; margin-bottom: 2rem; color: var(--muted); }
.detail .lead {
  max-width: 100%;
  margin-left: 0;
}
.detail .meta {
  margin: 0.4rem 0 0;
  color: var(--muted);
}
.detail .chips {
  margin-top: 0.8rem;
  padding-top: 0;
}
.prose {
  margin-top: 0.5rem;
  padding: clamp(1.5rem, 3.5vw, 3rem) 0;
  font-size: 1.08rem;
}
.prose p { max-width: 68ch; }
.prose p:last-child { margin-bottom: 0; }
.media-link { display: inline-block; margin-top: 1rem; word-break: break-word; }
.press-prose {
  max-width: 760px;
  font-size: 1.06rem;
}
.press-prose h2,
.press-prose h3 {
  margin: 1.6rem 0 0.5rem;
  font-family: var(--font-body);
  font-size: 1rem;
}
.press-prose p {
  margin: 0 0 1rem;
}
.press-prose a {
  color: inherit;
}
.people-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
}
.person-card {
  min-height: 0;
  margin: 0 -1px -1px 0;
  background: var(--paper);
  border: 1px solid var(--ink);
}
.person-copy {
  min-width: 0;
  padding: 1rem;
}
.person-copy h3 {
  margin-top: 0;
}
.person-copy .meta,
.person-bio p {
  color: var(--muted);
  margin: 0 0 0.75rem;
}
.person-card .links-row {
  margin-top: 0.9rem;
}
.person-card .links-row a {
  max-width: 100%;
  overflow-wrap: anywhere;
}

@media (max-width: 860px) {
  .topbar { position: static; align-items: flex-start; flex-direction: column; }
  .submenu { position: static; margin-top: 0.35rem; }
  .hero { min-height: auto; }
  .hero-grid { grid-template-columns: 1fr; }
  .portrait-slot { width: min(100%, 320px); }
  .hero-title-lockup { grid-template-columns: clamp(72px, 22vw, 120px) minmax(0, auto); }
  h1 { font-size: clamp(3rem, 18vw, 6rem); }
  .lead { margin-left: 0; }
  .section-head { display: block; }
  .grid, .grid.compact, .media-grid, .people-grid { grid-template-columns: 1fr; }
  .youtube-grid { grid-template-columns: 1fr; }
  .card { min-height: auto; }
}
`;

await build();

if (args.has("--watch")) {
  const { watch } = await import("node:fs");
  console.log("Built dist/. Watching content and scripts...");
  watch(contentDir, { recursive: true }, async () => {
    try {
      await build();
      console.log("Rebuilt dist/.");
    } catch (error) {
      console.error(error);
    }
  });
}
