# Personal website

Static personal website generated from Markdown content.

## Edit content

- Homepage intro, portrait, and links: `content/site.md`
- Research technologies / contributions: `content/tech/*.md`
- Artistic projects: `content/works/*.md`
- Media entries: `content/media/*.md`
- Academic research: `content/academic-research.md`
- Teaching: `content/teaching-confs.md`

The homepage only contains the personal presentation from `content/site.md`.
Category pages are generated as:

- `dist/research.html` with `#technologies` and `#publications`
- `dist/projects.html`
- `dist/media.html`
- `dist/teaching.html`

Each category page presents its entries one by one on a single page. On the research page, technology entries come first, followed by the formal list of publications.

Each content file uses frontmatter for structured fields such as `composer`, `date`, `location`, `place`, `files`, `media`, `type` and `technologies`.

Research technology entries can also use:

```md
demos:
  - https://youtu.be/video-id
used_by:
  - Artist or project name
links:
  github: https://github.com/example/repo
  paper: https://doi.org/example
```

To add a homepage image, put an image in `assets/`, for example `assets/profile.jpg`, then set this in `content/site.md`:

```md
portrait: /assets/profile.jpg
```

Example work page:

```md
---
title: Project title
composer: Artist name
date: 2026-01-01
place: Venue / city
type: collaboration
technologies: [RAVE, AFTER]
files:
  - https://youtu.be/video-id
featured: true
---

Main text of the page, written in Markdown.
```

To add a new entry, duplicate an existing Markdown file in the right `content/` folder, edit the frontmatter and body, then run `npm run build`. YouTube links in `files` on project entries are embedded automatically; `media` can be a YouTube URL or an `.mp4`.

### New video content

- Edit the wind device explanation in `content/works/electro-odyssee.md`, between `<!-- device -->` and `<!-- documentary -->`. This text appears to the left of the demo on desktop, and above it on mobile.
- Edit the documentary introduction below `<!-- documentary -->`. The two `extracts` appear in order, left to right on desktop and stacked on mobile, followed by `documentary_url`.
- The corresponding Media entry is `content/media/phantasia.md`.
- The IRCAM Forum AFTER demo is the `featured_demo` in `content/tech/after.md`.

These videos and their JPEG posters are stored in `assets/site/`, included in the static build, and served directly by Netlify. New players load their poster first and fetch video only when played. For `device_video`, `featured_demo`, and `extracts`, the poster uses the same filename with a `.jpg` extension.

The documentary extracts were cropped from their 1080 × 1350 Instagram layouts to the central 1080 × 608 picture (`crop=1080:608:0:370`). The wind demo retains its 4:5 format at 720 × 900, and AFTER retains 1920 × 1080 for interface readability. All four use H.264 (CRF 22, slow preset), AAC audio at 192 kb/s, and MP4 fast-start metadata for streaming. Originals remain outside the repository.

## Build

```sh
npm run build
```

The generated website is written to `dist/`.

## Local preview

```sh
cd dist
python3 -m http.server 4173
```

Then open `http://localhost:4173`.
