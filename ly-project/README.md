# LegalPlatform

Search and question-answering over a citation-aware corpus of Indian bail
jurisprudence. Consumes the `bail_rag` MongoDB Atlas database built by the
**LegalRAG-Data** repo — 198 judgments, 7,722 embedded chunks, 336 citation
edges — and adds nothing to it. This repo is read-only against that data.

```
search a question  ->  ranked cases  ->  read the official PDF
                                     ->  structured summary
                                     ->  chat with that one judgment
```

---

## Run it

Two processes. The API must be up before the web app is useful.

```bash
cd server && npm install && npm run dev     # http://localhost:8080
cd web    && npm install && npm run dev     # http://localhost:5173
```

`web` proxies `/api` to port 8080, so the browser sees a single origin.

### Environment

`server/.env` (gitignored — copy from `server/.env.example`):

| Key | Notes |
| --- | --- |
| `MONGO_URI` | the same Atlas cluster the data pipeline wrote to |
| `GROQ_API_KEY` | from https://console.groq.com/keys — **required for Summary and Chat only**; search and reading work without it |
| `GROQ_MODEL` | defaults to `openai/gpt-oss-120b` |

**First start takes ~3 minutes** while the BGE ONNX weights (~440 MB) download.
Every start after that is a few seconds — the weights are cached in
`node_modules/.cache`.

---

## The four things you must not break

Each of these is load-bearing, and breaking one fails quietly rather than
loudly.

### 1. Query embeddings must stay in the corpus's vector space

The 7,722 chunks were embedded in **Python** with `sentence-transformers` using
`BAAI/bge-base-en-v1.5`. `server/src/lib/embed.ts` reproduces that exactly with
the ONNX build — verified at **cosine 1.000000, max elementwise difference
0.000000** against a real corpus chunk.

Two details carry that parity:

- **pooling is `cls`, not `mean`** — BGE pools the `[CLS]` token
- **queries get the prefix `"Represent this sentence for searching relevant
  passages: "`, passages get none** — BGE is asymmetric

Change either and search still "works". It just returns worse results, with no
error to tell you.

This is also why an embedding API cannot be substituted: a Gemini or OpenAI
embedding of the query is a vector in a different space, and comparing it to
these chunks yields noise.

### 2. `content_type` must reach the user

Only **4,988 of the 7,722 chunks are the court's own words.** The rest:

| | count | what it is |
| --- | --- | --- |
| `court_text` | 4,988 | the court speaking |
| `quoted_other` | 1,917 | dictionaries, foreign courts, reports |
| `editorial` | 346 | SCR headnotes — written by law reporters |
| `quoted_case` | 316 | passages quoted from other judgments |
| `quoted_statute` | 155 | bare statutory text |

If a user reads the text of s. 41A CrPC and understands it as *"the Supreme
Court held…"*, they have been misinformed about the law. Worse, one blockquote
in Antil quotes a 1925 Rangoon case that the next paragraph records as
**dissented from** — retrieved flat, it reads as good law.

So the label travels from Mongo, through the API, into the LLM prompt (see
`ATTRIBUTION` in `server/src/lib/llm.ts`), and onto the screen as a badge.
Corpus search defaults to `court_text` + `editorial` only.

### 3. `court_tier` must reach the user

**1,004 chunks are High Court, 3 are a tribunal.** In Indian law a High Court
decision does not bind the way a Supreme Court one does, so the case page shows
a banner when you are not reading a Supreme Court judgment.

### 4. PDF for reading, HTML chunks for answering

The same judgment exists in two representations and they are used for different
things — deliberately:

- **The official SCR PDF** (`/api/cases/:tid/pdf`, streamed from the public S3
  bucket) is what the user *reads*. It is the citable, authentic document.
- **The chunks parsed from Kanoon HTML** are what the chatbot *reads*. Only
  they carry `content_type`, section labels and citation polarity — a PDF has
  no `<p>` versus `<blockquote>` to derive them from.

**140 of the 198 cases have a PDF.** The other 58 — every High Court case,
everything pre-1950 — fall back to the Text tab automatically.

---

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | counts, so you can see the DB is reachable |
| `GET /api/search?q=` | ranked **cases**, with the passages that made each rank |
| `GET /api/search/passages?q=` | flat passage ranking, for debugging relevance |
| `GET /api/cases/:tid` | metadata, chunk composition, citations with polarity |
| `GET /api/cases/:tid/pdf` | proxies the official SCR PDF |
| `GET /api/cases/:tid/text` | chunks in document order, labelled |
| `POST /api/cases/:tid/summary` | Issue / Held / Principle |
| `POST /api/cases/:tid/bail-analysis` | bail outcome, reasons, factors, conditions and a structured summary, each pinned to passages. `?refresh=1` re-runs |
| `GET /api/cases/:tid/bail-analysis` | the cached analysis, or 404. Never calls the model |
| `POST /api/cases/:tid/chat` | case-scoped Q&A, streamed over SSE |
| `GET /api/graph` | the whole citation graph — 200 nodes, 336 edges |
| `GET /api/graph/ego/:tid?depth=1\|2` | one case's citation neighbourhood |

Search filters: `courtTier`, `yearFrom`, `yearTo`, `contentTypes`, `limit`.

### How search works

Two retrievers, fused with Reciprocal Rank Fusion (k=60):

- **`$vectorSearch`** on `embedding` — semantic. Finds the right passage for
  *"when can bail be refused for financial crimes"* even when it uses none of
  those words.
- **`$search`** (BM25) on `text` — lexical. Finds the passage that names
  **"Section 439"** exactly, which the vector arm reliably misses because
  provision numbers carry almost no semantic signal.

Neither alone is enough, which is why the data phase built both indexes.

A case's score is the sum of its **best three** passages: one strong hit
shouldn't outrank a case that is relevant throughout, and summing every passage
would just reward long judgments for being long.

### Why case-scoped chat doesn't use Atlas

`chunks_vector_index` declares filter fields `court_tier`, `content_type`,
`chunk_kind`, `year`, `layer`, `section_primary` — but **not `tid`**, so
`$vectorSearch` cannot pre-filter to one case. Rather than rebuild the index,
`caseContext.ts` pulls that case's chunks and cosines them in memory: the
largest judgment has 428 chunks and the median has 18, so it is a few hundred
dot products. The Atlas index keeps doing only the cross-corpus job it was
built for.

### Bail outcome & judgment analysis

The case page's **Bail outcome** tab answers what a reader of a bail judgment
wants first: was bail granted or rejected, why, and on what factors. It shows
the outcome as a banner (and as a badge in the case header once known), a
Background / Issue / Decision / Principle summary, the court's reasons, the
factors it weighed (gravity, flight risk, tampering, custody period, delay,
parity, Article 21…) marked as favouring or weighing against the accused, any
conditions imposed, and the paragraphs each of those rests on.

`server/src/lib/bailAnalysis.ts` picks the context deliberately: the closing
passages (where the operative order is made, flagged as such to the model),
then the SCR headnote, then the best matches for three probes (outcome /
reasons / custody & liberty), within a 4k-token budget, put back in document
order. Outcomes: granted, rejected, partly granted, cancelled, remanded,
directions (guideline judgments such as Antil), not a bail decision, unclear.

The model returns JSON citing passage numbers, and the server checks it:

- citations to passages the model was never shown are dropped;
- an outcome with no citation gets the closing passage whose wording makes the
  order ("bail applications are dismissed…"), and the UI says it was located
  that way;
- an outcome resting only on a mid-judgment passage is marked medium confidence
  with a warning — Antil's "The appeal is dismissed accordingly." at p. 53 is a
  quoted order of another court, labelled `court_text` by the chunker;
- an outcome resting only on quoted material is marked low confidence.

Results are cached in memory per case; nothing is written to Mongo. Checked
against Sanjay Chandra (granted), Siddharam Mhetre (anticipatory, granted),
Kalyan Chandra Sarkar and State of Bihar v. Rajballav (cancelled), Sharad Kumar
(HC, rejected), Antil (directions) and A.K. Gopalan (not a bail decision).

---

### The citation graph

Rendered with `react-force-graph-2d` (canvas). **No NetworkX and no graph
database**: NetworkX is a Python analysis library, this backend is Node, and
everything it would compute on 200 nodes is static because the corpus never
changes. If you want PageRank or centrality, compute it once in the data repo
and write the score onto `nodes` — no runtime dependency.

Two views:

- **Case page → Citation graph tab** — the ego graph, laid out in **columns**:
  cases this judgment cites on the left (ordered oldest to newest), the focus
  case in the middle, later cases citing it on the right. A free force layout
  scatters those three groups at random, which hides the one thing an ego graph
  exists to show — which way the citation runs. `Two hops` pulls the second
  ring and drops back to a force layout.
- **`/explore`** — all 198 judgments at once. Only well-cited nodes are
  labelled until you zoom or hover, or 200 labels overlap into noise.

**Two visual channels, two meanings.** Node *fill* is the court (slate = Supreme
Court, white = High Court), because which court decided a case changes what it
is worth as authority. Node *ring* is the role relative to the focus case
(indigo = cited by it, emerald = cites it, teal = the case itself). Node *size*
is how many citations it has in the corpus. They never compete for the same
channel.

**Hovering a node** fades the rest of the graph to its immediate neighbours and
opens a card with court, year, citation count, direction of the relationship,
and how the focus case treated it.

**Edge colour is deliberately lopsided.** 274 of the 336 edges are `pos`, so
colouring polarity naively yields a uniformly green picture where nothing
stands out. Approval is drawn as quiet grey; only `mixed` (amber) and `neg`
(rose) get colour and weight, because those 33 edges are the informative ones —
Sushila Aggarwal treats Sibbia as `mixed`, a Constitution Bench partly
departing from an earlier Constitution Bench.

Three rendering details that are easy to break:

1. **Label font size must be `11 / globalScale`, with no floor.** Labels are
   drawn in graph coordinates and multiplied by the zoom, so a `Math.max` floor
   makes them grow without limit as the view zooms in.
2. **Zoom is clamped to 1.8.** A 19-node ego graph otherwise fits at 4-5x and
   every node balloons.
3. **The view is re-fitted on an interval for the first 6 seconds.** A single
   fit catches the nodes still bunched at the origin, and `onEngineStop` did
   not fire reliably here.
4. **Column mode pins both x and y, not just x.** Fixing x alone collapses each
   column: the link force pulls every authority towards the centre at its target
   distance (70), which is much shorter than the 260 separating the columns, so
   the only way it can shorten a link is to drag everything to the same y — 18
   nodes stacked on one another. Pinning y as well also makes the layout
   deterministic and orders each column by date.
5. **The ego graph's canvas height scales with the taller column.** A case
   citing 18 others needs roughly 34px per row; a fixed height re-creates the
   overlap that pinning y just solved.

## Deferred work

**[GRAPH_RETRIEVAL.md](GRAPH_RETRIEVAL.md)** — the design for making the
citation graph influence retrieval rather than only being displayed: one-hop
citation expansion with polarity weighting, counter-authority warnings ("3 later
cases did not simply follow this"), and why the in-corpus citation counts are a
weak authority signal. Specified, not built.

## Known issues and limits

- **`section_primary` is a ranking signal, not a filter.** The data phase
  measured Kanoon's rhetorical-role labels at ~57% agreement on this corpus.
  Filtering on them would silently bury correctly-relevant reasoning.
- **418 chunks (5.4%) were truncated at embedding time** — they exceeded BGE's
  512-subword limit. Recall on those specific long passages is weaker.
- **Two nodes carry `duplicate_of`** and were never chunked, so 200 nodes = 198
  judgments here.
- **Citation polarity has not been validated by a human lawyer.** It comes from
  Kanoon's own `data-sentiment` annotations; `pos` means "relied on", not the
  technical "followed". The UI wording reflects that; don't strengthen it.
- **Node's DNS resolves to `127.0.0.1` on this machine** and that stub refuses
  SRV queries, which breaks `mongodb+srv://`. `config.ts` detects a
  loopback-only resolver and falls back to public DNS. Harmless elsewhere.

## Attribution

Citation data comes from Indian Kanoon, whose terms require a visible
"Powered by IKanoon" credit — it is in the app footer. Judgment PDFs come from
the Supreme Court of India open data set.
