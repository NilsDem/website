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
