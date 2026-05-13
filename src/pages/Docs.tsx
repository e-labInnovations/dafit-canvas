import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Binary,
  BookOpen,
  Boxes,
  ChevronRight,
  CircleDot,
  Image as ImageIcon,
  Info,
  Layers,
  Palette,
  Share2,
  Wand2,
  Watch,
  Workflow,
} from 'lucide-react'

type Section = {
  id: string
  title: string
  icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
}

const SECTIONS: Section[] = [
  { id: 'overview', title: 'What is a watch face?', icon: Watch },
  { id: 'hardware', title: 'The watch hardware', icon: CircleDot },
  { id: 'anatomy', title: 'Anatomy of a Type C face', icon: Boxes },
  { id: 'header', title: 'The header & watchface.txt', icon: Binary },
  { id: 'layers', title: 'Layers & element types', icon: Layers },
  { id: 'blobs', title: 'BMP blobs (the pixels)', icon: ImageIcon },
  { id: 'compression', title: 'Compression: RLE vs raw', icon: Wand2 },
  { id: 'sharing', title: 'Sharing blobs between layers', icon: Share2 },
  { id: 'colors', title: 'Colors: RGB565', icon: Palette },
  { id: 'pipeline', title: 'How the editor exports', icon: Workflow },
  { id: 'glossary', title: 'Quick glossary', icon: BookOpen },
]

function Docs() {
  // Plain text filter over the section list. The renderer below shows
  // *every* section regardless — the filter just dims/promotes matches in
  // the sidebar to help the reader skim a long page.
  const [query, setQuery] = useState('')

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.filter((s) => s.title.toLowerCase().includes(q))
  }, [query])

  return (
    <section className="docs">
      <header className="docs-header">
        <h1>Watch face format</h1>
        <p>
          A friendly guide to how a Da Fit / MoYoung <strong>Type C</strong>
          {' '}watch face is put together — and what each part means inside
          DaFit Canvas. No prior reverse-engineering knowledge required.
        </p>
      </header>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="Table of contents">
          <input
            type="search"
            placeholder="Filter sections…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="docs-toc-search"
            aria-label="Filter sections"
          />
          <ol>
            {filteredSections.map((s) => {
              const Icon = s.icon
              return (
                <li key={s.id}>
                  <a href={`#${s.id}`}>
                    <Icon size={14} aria-hidden />
                    <span>{s.title}</span>
                    <ChevronRight size={12} aria-hidden />
                  </a>
                </li>
              )
            })}
          </ol>
          <div className="docs-toc-aside">
            <Info size={14} aria-hidden />
            <span>
              Source-of-truth for type codes lives in{' '}
              <code>src/lib/dawft.ts</code>.
            </span>
          </div>
        </aside>

        <article className="docs-content">
          <section id="overview">
            <h2>
              <Watch size={20} aria-hidden /> What is a watch face?
            </h2>
            <p>
              A <strong>watch face</strong> is the little image you see on the
              screen of your smartwatch — the dial, the time, battery icon,
              step counter, and anything else painted on top. On the Da Fit
              family of watches it's just a single binary file ending in
              {' '}<code>.bin</code> that the watch loads and renders.
            </p>
            <p>
              You can think of a face as a recipe with two halves:
            </p>
            <ul>
              <li>
                <strong>A list of things to draw</strong> (the background, the
                hour digits, the battery icon, the date, …) — each entry says
                <em> what kind</em> of thing it is and <em>where</em> on the
                screen it goes.
              </li>
              <li>
                <strong>A pile of small images</strong> (BMPs) — the actual
                pixels the watch paints when it draws each thing.
              </li>
            </ul>
            <p>
              The watch's firmware reads the recipe top to bottom, fetches the
              right images, and paints them. That's it. There's no scripting,
              no CSS, no animations beyond a fixed-frame slot. It's intentionally
              dumb so the watch can render it on a tiny CPU.
            </p>
          </section>

          <section id="hardware">
            <h2>
              <CircleDot size={20} aria-hidden /> The watch hardware
            </h2>
            <ul className="docs-stats">
              <li>
                <span>Screen</span>
                <strong>240 × 240 pixels</strong>
              </li>
              <li>
                <span>Shape</span>
                <strong>Round (drawn on a square canvas)</strong>
              </li>
              <li>
                <span>Color</span>
                <strong>16-bit RGB565, no transparency</strong>
              </li>
              <li>
                <span>File type</span>
                <strong>Type C (fileID 0x81)</strong>
              </li>
            </ul>
            <p>
              The watch screen is <strong>round</strong>, but every image is
              stored as a normal rectangle. The watch just clips off the
              corners. The editor's preview shows the round overlay so you can
              tell what will be visible.
            </p>
            <p>
              <strong>16-bit color</strong> means each pixel takes 2 bytes — 5
              bits for red, 6 for green, 5 for blue. There's no alpha channel,
              so you can't have "transparent" pixels. To fake transparency,
              designers paint the pixels the same color as whatever's behind
              them.
            </p>
          </section>

          <section id="anatomy">
            <h2>
              <Boxes size={20} aria-hidden /> Anatomy of a Type C face
            </h2>
            <p>
              A Type C <code>.bin</code> is just three things glued together:
            </p>
            <ol className="docs-anatomy">
              <li>
                <strong>A header</strong> — fixed-size block at the start of
                the file. Says "this is a Type C face", lists how many things
                to draw, and points at where the images live in the file.
              </li>
              <li>
                <strong>A table of layers</strong> — one row per thing to
                draw, with its type, position, size, and which images it uses.
              </li>
              <li>
                <strong>A pile of compressed images</strong> — the actual
                bitmaps, packed end to end.
              </li>
            </ol>
            <pre className="docs-diagram">{`┌───────────────────────────────┐
│ Header (1900 bytes)           │  ← "I'm a Type C face. 9 layers, 47 blobs."
├───────────────────────────────┤
│ Layer table                   │  ← BACKGROUND at (0,0). TIME_H1 at (40,80). …
├───────────────────────────────┤
│ Blob #000 (background.bmp)    │
│ Blob #001 (digit "0".bmp)     │
│ Blob #002 (digit "1".bmp)     │
│ …                             │
│ Blob #046 (last image)        │
└───────────────────────────────┘`}</pre>
            <p>
              The header references each blob by index (<code>idx</code>), so
              the watch can jump straight to a blob without scanning the file.
              Every layer says "start at blob #N, take the next K blobs".
            </p>
          </section>

          <section id="header">
            <h2>
              <Binary size={20} aria-hidden /> The header & watchface.txt
            </h2>
            <p>
              When David Atkinson's <code>dawft</code> CLI takes a face
              <em> apart</em>, it doesn't show you the raw header — it gives
              you a folder with a <code>watchface.txt</code> file plus all the
              BMP images. The text file is the human-readable version of
              everything except the pixels. Here's a small example:
            </p>
            <pre className="docs-code">{`fileType    C
fileID      0x81
dataCount   3
blobCount   12
faceNumber  50001
faceData   0x01   0   0    0    240  240   # BACKGROUND
faceData   0x40   1   40   80   32   48    # TIME_H1 (hour-tens digit)
faceData   0x41   1   72   80   32   48    # TIME_H2 (hour-units digit, shares blobs)`}</pre>
            <ul className="docs-fields">
              <li>
                <code>fileType / fileID</code> — type marker. Type C is{' '}
                <code>0x81</code> in most cases (<code>0x84</code> on a few
                watch variants).
              </li>
              <li>
                <code>dataCount</code> — how many layers (<code>faceData</code>{' '}
                lines).
              </li>
              <li>
                <code>blobCount</code> — total number of BMP images.
              </li>
              <li>
                <code>faceNumber</code> — opaque ID. Most faces use{' '}
                <code>50001</code> by convention.
              </li>
              <li>
                <code>faceData TYPE IDX X Y W H</code> — one layer.{' '}
                <code>TYPE</code> picks the element kind (see next section),{' '}
                <code>IDX</code> is the starting blob index, and{' '}
                <code>X Y W H</code> is its rectangle.
              </li>
            </ul>
            <p className="docs-callout">
              <Info size={14} aria-hidden />
              The editor never asks you to edit <code>watchface.txt</code> by
              hand — it's just useful to understand what the binary contains.
              When you export, the editor writes everything for you.
            </p>
          </section>

          <section id="layers">
            <h2>
              <Layers size={20} aria-hidden /> Layers & element types
            </h2>
            <p>
              Each layer has a <strong>type code</strong> — a hex number that
              tells the watch <em>what kind of thing</em> this layer is. The
              type determines two things:
            </p>
            <ul>
              <li>
                <strong>How many blobs the layer consumes</strong> — a single
                background is 1 blob, a set of digits is 10, a weekday strip
                is 7, a progress bar is 11, an animation is whatever{' '}
                <code>animationFrames</code> says.
              </li>
              <li>
                <strong>How the firmware uses them</strong> — for digits, the
                firmware picks blob N to draw digit N. For a progress bar, it
                picks blob N to show step N. For a background, it just paints
                blob 0 once.
              </li>
            </ul>
            <h3 className="docs-h3">Common families</h3>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Family</th>
                  <th>Blobs</th>
                  <th>Examples</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Single static image</td>
                  <td>1</td>
                  <td>
                    <code>0x01</code> background, <code>0xf1</code>–
                    <code>0xf5</code> analog hands, logos
                  </td>
                </tr>
                <tr>
                  <td>Digit set</td>
                  <td>10</td>
                  <td>
                    <code>0x40</code>–<code>0x44</code> time digits,{' '}
                    <code>0x30</code> day, <code>0xd2</code> battery digits
                  </td>
                </tr>
                <tr>
                  <td>Name strip</td>
                  <td>7 or 12</td>
                  <td>
                    <code>0x60</code> day-of-week, <code>0x10</code>{' '}
                    month-name
                  </td>
                </tr>
                <tr>
                  <td>Progress bar</td>
                  <td>11</td>
                  <td>
                    <code>0x70</code> steps, <code>0x80</code> heart-rate
                  </td>
                </tr>
                <tr>
                  <td>Animation</td>
                  <td>= <code>animationFrames</code></td>
                  <td>
                    <code>0xf6</code>–<code>0xf8</code>
                  </td>
                </tr>
              </tbody>
            </table>
            <p>
              In the editor, you don't memorise hex codes — you pick a layer
              from the <strong>Insert layer</strong> menu (Background, Time
              digits, Steps, Heart rate, …) and the editor handles the type
              and slot count for you. Full table lives in{' '}
              <code>src/lib/dawft.ts</code>.
            </p>
          </section>

          <section id="blobs">
            <h2>
              <ImageIcon size={20} aria-hidden /> BMP blobs (the pixels)
            </h2>
            <p>
              The pixel data for every layer lives in a series of small BMP
              images, called <strong>blobs</strong>. Each blob is referenced
              by a number (<code>idx</code>); the layer table just says "I
              start at blob 5 and need 10 of them".
            </p>
            <p>
              Each <code>BMP</code> is a Windows-flavoured 16-bit RGB565
              bitmap — same width and height as the layer's slot, no
              transparency. Inside the <code>.bin</code> they may be
              compressed (see next section) but logically they're all just
              rectangular pixel grids.
            </p>
            <p className="docs-callout">
              <Info size={14} aria-hidden />
              In the editor we group blobs into an{' '}
              <strong>AssetSet</strong> — a named collection of N
              same-size bitmaps. Multiple layers can point at the same
              AssetSet so the same digits feed several counters.
            </p>
          </section>

          <section id="compression">
            <h2>
              <Wand2 size={20} aria-hidden /> Compression: RLE vs raw
            </h2>
            <p>
              Inside the <code>.bin</code>, each blob is one of two encodings:
            </p>
            <ul>
              <li>
                <strong>RLE_LINE</strong> — a simple run-length encoding,
                line by line. Identical pixels in a row collapse to a count.
                Saves space on flat colours and gradients.
              </li>
              <li>
                <strong>NONE</strong> — raw RGB565 pixels, no encoding.
                Bigger, but the firmware decodes them as-is.
              </li>
            </ul>
            <p className="docs-callout docs-callout-warn">
              <AlertTriangle size={14} aria-hidden />
              <span>
                <strong>Important quirk:</strong> some watch firmwares
                mis-decode RLE for specific blob kinds (heart-rate digits,
                day-number digits, certain separators). Those blobs are
                shipped uncompressed in the wild. DaFit Canvas preserves
                whatever encoding the source <code>.bin</code> used so
                re-saving a working face never breaks it.
              </span>
            </p>
          </section>

          <section id="sharing">
            <h2>
              <Share2 size={20} aria-hidden /> Sharing blobs between layers
            </h2>
            <p>
              Several layers can <em>share</em> the same blob range. For
              example, the four time digits (
              <code>HH:MM</code> → two hour digits + two minute digits) often
              point at the <em>same</em> 10-glyph digit set — the firmware
              just picks the right blob per digit, no need to duplicate the
              pixels.
            </p>
            <p>
              <strong>But sharing isn't free-for-all</strong>. The firmware
              only handles a known set of share combinations cleanly.
              Sharing a progress bar between Steps and Calories, for
              instance, is never done in real faces — and tends to render
              garbage on the watch.
            </p>
            <p>
              DaFit Canvas keeps a whitelist derived from a corpus of 387
              real watch faces. The Insert / Rebind UI will flag or refuse
              risky combinations.
            </p>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Combo</th>
                  <th>Safe?</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>0x40 + 0x41 + 0x43 + 0x44</code> (all time digits)</td>
                  <td>✅</td>
                  <td>Universal in real faces</td>
                </tr>
                <tr>
                  <td><code>0x11 + 0x30</code> (month + day)</td>
                  <td>✅</td>
                  <td>Common</td>
                </tr>
                <tr>
                  <td><code>0x70 + 0x90</code> (steps + calories progbar)</td>
                  <td>❌</td>
                  <td>Zero faces in corpus, renders broken</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section id="colors">
            <h2>
              <Palette size={20} aria-hidden /> Colors: RGB565
            </h2>
            <p>
              The watch can't show 24-bit color. Each pixel is squeezed into
              16 bits:
            </p>
            <pre className="docs-code">{`R5 R4 R3 R2 R1  G6 G5 G4 G3 G2 G1  B5 B4 B3 B2 B1
└── 5 bits ──┘  └── 6 bits ──┘    └── 5 bits ──┘
   red             green             blue`}</pre>
            <p>
              That gives 65,536 distinct colors — plenty for icons and
              digits, but you'll see banding on photographic backgrounds. The
              encoder rounds 8-bit channels by shifting:
            </p>
            <pre className="docs-code">{`const r = (pixel.r >> 3) & 0x1F
const g = (pixel.g >> 2) & 0x3F
const b = (pixel.b >> 3) & 0x1F
const rgb565 = (r << 11) | (g << 5) | b`}</pre>
            <p>
              Bytes are stored <strong>little-endian</strong> (low byte first).
              That's a common gotcha when you compare raw bytes against a
              hex-editor view.
            </p>
          </section>

          <section id="pipeline">
            <h2>
              <Workflow size={20} aria-hidden /> How the editor exports
            </h2>
            <ol className="docs-pipeline">
              <li>
                <strong>Layer table → faceData rows.</strong> Each layer in
                the editor becomes one <code>faceData</code> line with its
                type, position and the index of its first blob.
              </li>
              <li>
                <strong>AssetSets → blob ranges.</strong> Each shared
                AssetSet is laid out once. Multiple consumer layers point at
                the same starting index.
              </li>
              <li>
                <strong>Blob ordering matters.</strong> Progress bars are
                placed at low indices first, then multi-blob sets in count
                order, then singletons. This matches how the firmware
                expects to find them.
              </li>
              <li>
                <strong>Per-slot compression preserved.</strong> If a blob
                came in as raw RGB565, it goes out raw. If it came in
                RLE-encoded, it goes back RLE.
              </li>
              <li>
                <strong>Header written, file flushed.</strong> The 1900-byte
                header gets all counts, offsets and the
                <code> faceNumber</code>, then every blob is appended in
                order.
              </li>
            </ol>
            <p>
              From there you take the <code>.bin</code> and feed it to{' '}
              <code>dawfu</code> — the BLE uploader — to actually flash it
              to a watch. DaFit Canvas builds the binary; <code>dawfu</code>{' '}
              puts it on the watch.
            </p>
          </section>

          <section id="glossary">
            <h2>
              <BookOpen size={20} aria-hidden /> Quick glossary
            </h2>
            <dl className="docs-glossary">
              <dt>Type C</dt>
              <dd>
                One of several Da Fit binary formats. The most common one;
                240×240, RGB565, what this editor targets.
              </dd>
              <dt>FaceN</dt>
              <dd>
                A different (less common) format also supported by the
                editor. Uses JSON instead of <code>watchface.txt</code>.
              </dd>
              <dt>Blob</dt>
              <dd>
                One BMP image inside the <code>.bin</code>. Referenced by an
                index (<code>idx</code>).
              </dd>
              <dt>AssetSet</dt>
              <dd>
                Editor concept — a named collection of same-size bitmaps
                shared by one or more layers.
              </dd>
              <dt>RLE_LINE</dt>
              <dd>
                A simple line-based run-length encoding used by Da Fit.
              </dd>
              <dt>dawft</dt>
              <dd>
                The CLI tool by David Atkinson that originally reverse-
                engineered the format. Pack/unpack on the desktop.
              </dd>
              <dt>dawfu</dt>
              <dd>
                David Atkinson's BLE uploader. Pushes a built{' '}
                <code>.bin</code> over Bluetooth to the watch.
              </dd>
            </dl>
            <p className="docs-back">
              <Link to="/editor" className="counter">
                Open the editor →
              </Link>
            </p>
          </section>
        </article>
      </div>
    </section>
  )
}

export default Docs
