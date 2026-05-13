import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const contentDir = join(root, "content");
const distDir = join(root, "dist");
const mapCacheDir = join(root, ".cache/generated-maps");
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

function entryChips(entry) {
  if (entry.section === "works") return "";
  return chips(entry.technologies || entry.tool);
}

function schematicFigure(entry) {
  if (!entry.schematic) return "";
  const alt = entry.schematic_alt || `${entry.title} schematic`;
  return `<figure class="entry-schematic">
    <img src="${escapeHtml(entry.schematic)}" alt="${escapeHtml(alt)}" loading="lazy">
  </figure>`;
}

function card(entry) {
  return `<article class="card ${entry.featured ? "featured" : ""}">
    <a class="card-link" href="${entry.url}">
      <span class="kicker">${escapeHtml(entry.type || entry.status || entry.section)}</span>
      <h3>${escapeHtml(entry.title)}</h3>
      ${metaLine(entry) ? `<p class="meta">${metaLine(entry)}</p>` : ""}
      <p>${escapeHtml(entry.summary || entry.body.split(/\n/)[0] || "")}</p>
      ${entryChips(entry)}
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
    <a class="legend-title${current ? "" : " active"}" href="/"${current ? "" : ' aria-current="page"'}>Nils Demerlé</a>
    <div class="${itemClass("research")}">
      ${legendLink("research", "/research.html", "Research")}
    </div>
    <div class="${itemClass("projects")}">
      ${legendLink("projects", "/projects.html", "Projects")}
    </div>
    <div class="${itemClass("media")}">${legendLink("media", "/media.html", "Medias")}</div>
    <div class="${itemClass("teaching")}">${legendLink("teaching", "/teaching.html", "Teaching")}</div>
  </nav>`;
}

function pageShell({ title, description, body, current = "", siteTitle: titleInHeader = siteTitle }) {
  const mapId = current || "home";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description || "ACIDS")}" />
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="map-${escapeHtml(mapId)}">
  ${mainNav(current)}
  ${body}
  <div class="coordinate-readout" aria-live="off">LAT 48.85660 N / LONG 2.35220 E / ALT 72 M</div>
  <script>
    (() => {
      const readout = document.querySelector(".coordinate-readout");
      if (!readout) return;
      const origin = { lat: 48.8566, lon: 2.3522 };
      const span = { lat: 0.082, lon: 0.14, scrollLat: 0.000018, scrollLon: 0.000006 };
      let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const format = (value, positive, negative) => Math.abs(value).toFixed(5) + " " + (value >= 0 ? positive : negative);
      const altitude = (x, y) => {
        const ridge = Math.sin(x * 0.017 + y * 0.010) * 38 + Math.sin(x * 0.031 - y * 0.014 + 2.1) * 22;
        const hills = Math.sin((x - 220) * 0.008) * Math.cos((y + 80) * 0.006) * 120;
        const detail = Math.sin((x + y) * 0.021) * 18;
        return Math.round(180 + ridge + hills + detail);
      };
      const update = () => {
        const nx = pointer.x / Math.max(window.innerWidth, 1) - 0.5;
        const ny = pointer.y / Math.max(window.innerHeight, 1) - 0.5;
        const scroll = window.scrollY || document.documentElement.scrollTop || 0;
        const lat = origin.lat - ny * span.lat - scroll * span.scrollLat;
        const lon = origin.lon + nx * span.lon + scroll * span.scrollLon;
        const mapX = pointer.x + window.innerWidth * 0.5;
        const mapY = pointer.y + scroll;
        readout.textContent = "LAT " + format(lat, "N", "S") + " / LONG " + format(lon, "E", "W") + " / ALT " + altitude(mapX, mapY) + " M";
      };
      window.addEventListener("pointermove", (event) => {
        pointer = { x: event.clientX, y: event.clientY };
        update();
      }, { passive: true });
      window.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update, { passive: true });
      update();
    })();
  </script>
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
    ${entryChips(entry)}
    <div class="entry-content ${entry.schematic ? "has-schematic" : ""}">
      <section class="prose">${entry.bodyHtml}</section>
      ${schematicFigure(entry)}
    </div>
    ${mediaEmbed(entry)}
    ${youtubeEmbedGrid(demoUrls)}
    ${youtubeEmbeds(entry)}
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
    [210, 620, 190, 0.86],
    [640, 980, 260, 0.48],
    [1510, 940, 210, 1.12],
    [1120, 1500, 260, 0.56],
    [1390, 1780, 250, 1.24],
    [430, 2470, 210, 0.78],
    [970, 3020, 320, 0.44],
    [1190, 3860, 280, 1.02],
    [280, 4550, 240, 0.62],
    [230, 5230, 260, 0.92],
    [1500, 5750, 300, 0.72],
    [1450, 6460, 220, 1.08],
    [740, 6820, 220, 0.86],
    [1630, 7080, 260, 0.94],
    [1320, 520, 78, 0.34],
    [260, 1260, 68, 0.3],
    [820, 1420, 92, 0.28],
    [1540, 2380, 76, 0.36],
    [510, 3340, 60, 0.28],
    [1340, 3520, 84, 0.34],
    [1180, 4920, 70, 0.32],
    [310, 6040, 78, 0.32],
    [980, 6180, 86, 0.26],
    [1480, 6900, 58, 0.28],
  ];
  const ridges = [
    [940, 0, 0.00005, 0.34],
    [620, 2500, 0.00004, 0.28],
    [1120, 4600, 0.000035, 0.25],
    [1540, 1200, 0.000055, 0.2],
    [360, 6100, 0.00005, 0.22],
  ];
  let value = -0.3;

  for (const [cx, cy, radius, strength] of peaks) {
    const dx = x - cx;
    const dy = y - cy;
    value += Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius)) * strength;
  }

  for (const [cx, cy, falloff, strength] of ridges) {
    const ridgeX = cx + Math.sin((y + cy) * 0.003) * 150;
    value += Math.exp(-Math.abs(x - ridgeX) * Math.abs(x - ridgeX) * falloff) * strength;
  }

  value += valueNoise(x, y, 300) * 0.13;
  value += valueNoise(x + 400, y - 900, 145) * 0.07;
  value += valueNoise(x - 180, y + 300, 86) * 0.032;
  value += valueNoise(x + 1000, y + 1400, 48) * 0.012;
  value += Math.sin(x * 0.017 + y * 0.010) * 0.035;
  value += Math.sin(x * 0.031 - y * 0.014 + 2.1) * 0.018;
  value += Math.sin((x + y) * 0.006) * 0.026;
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

const mapVariants = {
  home: { file: "topography-home.svg", x: 0, y: 0, filterSeed: 11 },
  research: { file: "topography-research.svg", x: 720, y: 1080, filterSeed: 13 },
  projects: { file: "topography-projects.svg", x: -520, y: 2440, filterSeed: 17 },
  media: { file: "topography-media.svg", x: 1180, y: 3860, filterSeed: 19 },
  teaching: { file: "topography-teaching.svg", x: -940, y: 5200, filterSeed: 23 },
};

function topographySvg({ x: offsetX = 0, y: offsetY = 0, filterSeed = 11 } = {}) {
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
          terrainValue(x + offsetX, y + offsetY),
          terrainValue(x + size + offsetX, y + offsetY),
          terrainValue(x + size + offsetX, y + size + offsetY),
          terrainValue(x + offsetX, y + size + offsetY),
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
      <feTurbulence type="fractalNoise" baseFrequency="0.018 0.031" numOctaves="2" seed="${filterSeed}" result="noise"/>
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

function mapCacheKey(variant) {
  const source = [
    "map-cache-v1",
    fade.toString(),
    mix.toString(),
    hash2.toString(),
    valueNoise.toString(),
    terrainValue.toString(),
    contourSegment.toString(),
    topographySvg.toString(),
    JSON.stringify(variant),
  ].join("\n");

  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

async function writeCachedTopography(variant) {
  const target = join(distDir, "assets/generated", variant.file);
  const cacheFile = join(mapCacheDir, `${variant.file.replace(/\.svg$/, "")}-${mapCacheKey(variant)}.svg`);

  try {
    await copyFile(cacheFile, target);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const svg = topographySvg(variant);
  await mkdir(mapCacheDir, { recursive: true });
  await writeFile(cacheFile, svg, "utf8");
  await copyFile(cacheFile, target);
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
  await Promise.all(Object.values(mapVariants).map((variant) => writeCachedTopography(variant)));
  await copyFile(join(distDir, "assets/generated", mapVariants.home.file), join(distDir, "assets/generated/topography.svg"));
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
  --ink: #12120f;
  --muted: #5f5d56;
  --paper: rgba(255, 255, 255, 0.84);
  --line: #34342f;
  --soft: rgba(18, 18, 15, 0.08);
  --acid: #b6ff00;
  --red: #ff4b4b;
  --blue: #2248ff;
  --grid: rgba(18, 18, 15, 0.065);
  --grid-strong: rgba(18, 18, 15, 0.12);
  --paper-bg: #f4f3ee;
  --frame-inset: clamp(0.9rem, 3vw, 2.4rem);
  --frame-line: rgba(18, 18, 15, 0.66);
  --map-image: url("/assets/generated/topography-home.svg");
  --font-body: "Geist Mono", "Avenir Next", "Inter", "Helvetica Neue", Arial, sans-serif;
  --font-display: "Geist Mono", "Avenir Next Condensed", "DIN Condensed", "Helvetica Neue", Arial, sans-serif;
  --font-title: "Geist Mono", "Avenir Next Condensed", "DIN Condensed", sans-serif;
  --font-mono: "Geist Mono", "SFMono-Regular", Consolas, monospace;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  position: relative;
  min-height: 100vh;
  margin: 0;
  color: var(--ink);
  background-image: var(--map-image);
  background-color: var(--paper-bg);
  background-position: var(--frame-inset) var(--frame-inset);
  background-repeat: no-repeat;
  background-size: 1800px auto;
  background-attachment: scroll;
  font-family: var(--font-body);
  line-height: 1.45;
}
body.map-home { --map-image: url("/assets/generated/topography-home.svg"); }
body.map-research { --map-image: url("/assets/generated/topography-research.svg"); }
body.map-projects { --map-image: url("/assets/generated/topography-projects.svg"); }
body.map-media { --map-image: url("/assets/generated/topography-media.svg"); }
body.map-teaching { --map-image: url("/assets/generated/topography-teaching.svg"); }
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
body::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  background:
    linear-gradient(var(--paper-bg), var(--paper-bg)) top left / 100% var(--frame-inset) no-repeat,
    linear-gradient(var(--paper-bg), var(--paper-bg)) bottom left / 100% var(--frame-inset) no-repeat,
    linear-gradient(var(--paper-bg), var(--paper-bg)) top left / var(--frame-inset) 100% no-repeat,
    linear-gradient(var(--paper-bg), var(--paper-bg)) top right / var(--frame-inset) 100% no-repeat,
    linear-gradient(var(--frame-line), var(--frame-line)) left var(--frame-inset) top var(--frame-inset) / calc(100% - (2 * var(--frame-inset))) 1px no-repeat,
    linear-gradient(var(--frame-line), var(--frame-line)) left var(--frame-inset) bottom var(--frame-inset) / calc(100% - (2 * var(--frame-inset))) 1px no-repeat,
    linear-gradient(var(--frame-line), var(--frame-line)) left var(--frame-inset) top var(--frame-inset) / 1px calc(100% - (2 * var(--frame-inset))) no-repeat,
    linear-gradient(var(--frame-line), var(--frame-line)) right var(--frame-inset) top var(--frame-inset) / 1px calc(100% - (2 * var(--frame-inset))) no-repeat,
    repeating-linear-gradient(90deg, var(--frame-line) 0 1px, transparent 1px 120px) left var(--frame-inset) top var(--frame-inset) / calc(100% - (2 * var(--frame-inset))) 0.38rem no-repeat,
    repeating-linear-gradient(90deg, var(--frame-line) 0 1px, transparent 1px 120px) left var(--frame-inset) bottom var(--frame-inset) / calc(100% - (2 * var(--frame-inset))) 0.38rem no-repeat,
    repeating-linear-gradient(0deg, var(--frame-line) 0 1px, transparent 1px 120px) left var(--frame-inset) top var(--frame-inset) / 0.38rem calc(100% - (2 * var(--frame-inset))) no-repeat,
    repeating-linear-gradient(0deg, var(--frame-line) 0 1px, transparent 1px 120px) right var(--frame-inset) top var(--frame-inset) / 0.38rem calc(100% - (2 * var(--frame-inset))) no-repeat;
}
a { color: inherit; text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
.main-nav {
  position: fixed;
  right: calc(var(--frame-inset) + clamp(0.7rem, 1.8vw, 1.2rem));
  top: calc(var(--frame-inset) + clamp(0.7rem, 1.8vw, 1.2rem));
  z-index: 30;
  display: grid;
  width: min(14rem, calc(100vw - 2rem));
  padding: 0.96rem;
  background: rgba(255, 255, 255, 0.86);
  border: 0;
  backdrop-filter: blur(12px);
}
.main-nav::before {
  content: "";
  position: absolute;
  inset: 0.38rem;
  pointer-events: none;
  border: 1px solid rgba(18, 18, 15, 0.52);
}
.legend-title {
  display: block;
  padding: 0.08rem 0.18rem 0.35rem;
  color: var(--ink);
  font-size: 0.72rem;
  font-weight: 500;
  line-height: 1;
  text-transform: uppercase;
  text-decoration: none;
  white-space: nowrap;
}
.legend-title.active {
  font-weight: 800;
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
  padding: 0.44rem 0.18rem;
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1;
  text-decoration: none;
}
.nav-item:hover .legend-link,
.nav-item.active .legend-link {
  color: var(--ink);
}
.nav-item.active .legend-link {
  font-weight: 800;
}
.legend-symbol {
  position: relative;
  display: inline-grid;
  flex: 0 0 auto;
  width: 1.15rem;
  height: 1.15rem;
  place-items: center;
  color: var(--line);
}
.legend-symbol::before,
.legend-symbol::after {
  content: "";
  display: block;
}
.coordinate-readout {
  position: fixed;
  right: clamp(0.7rem, 2vw, 1.2rem);
  bottom: clamp(0.55rem, 1.6vw, 1rem);
  z-index: 25;
  color: rgba(18, 18, 15, 0.58);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 400;
  line-height: 1;
  letter-spacing: 0;
  pointer-events: none;
  user-select: none;
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
  font-weight: 300;
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
.links-row a:hover { background: rgba(18, 18, 15, 0.08); }
.links-row span {
  color: var(--muted);
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}
.category {
  max-width: 1160px;
  padding: clamp(3rem, 7vw, 6rem) 0;
}
.category-head {
  margin-bottom: clamp(1.4rem, 3.5vw, 2.8rem);
}
.category-head h1 {
  font-family: var(--font-title);
  font-weight: 300;
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
  gap: clamp(1.6rem, 4vw, 3.4rem);
}
.entry-block {
  padding: clamp(1rem, 2.8vw, 2rem) 0;
}
.entry-block h2 {
  white-space: normal;
}
.entry-block .lead {
  max-width: 100%;
  margin-top: 0.25rem;
}
.entry-block .lead.meta {
  color: rgba(18, 18, 15, 0.82);
  font-size: clamp(1.02rem, 1.18vw, 1.18rem);
}
.entry-block .chips {
  width: fit-content;
  margin-top: 0.55rem;
  padding-top: 0;
}
.entry-block .links-row {
  margin-top: 0.65rem;
}
.entry-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: clamp(1rem, 3vw, 2rem);
  align-items: start;
  margin-top: 0.25rem;
}
.entry-content.has-schematic {
  grid-template-columns: minmax(0, 1fr) minmax(220px, 32%);
}
.entry-schematic {
  margin: clamp(1rem, 2.4vw, 2rem) 0 0;
  padding: 0;
}
.entry-schematic img {
  display: block;
  width: 100%;
  height: auto;
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
.detail h1 {
  max-width: 14ch;
  font-family: var(--font-title);
  font-size: clamp(3rem, 8vw, 7rem);
  font-weight: 300;
}
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
  margin-top: 0.35rem;
  padding: clamp(0.55rem, 1.7vw, 1.35rem) 0;
  font-size: 1.14rem;
  text-align: justify;
  text-justify: inter-word;
}
.prose p { max-width: 78ch; }
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
  .main-nav { position: static; width: auto; margin: 1rem; }
  .hero { min-height: auto; }
  .hero-grid { grid-template-columns: 1fr; }
  .portrait-slot { width: min(100%, 320px); }
  .hero-title-lockup { grid-template-columns: clamp(72px, 22vw, 120px) minmax(0, auto); }
  h1 { font-size: clamp(3rem, 18vw, 6rem); }
  .lead { margin-left: 0; }
  .section-head { display: block; }
  .grid, .grid.compact, .media-grid, .people-grid { grid-template-columns: 1fr; }
  .entry-content.has-schematic { grid-template-columns: 1fr; }
  .prose { text-align: left; }
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
