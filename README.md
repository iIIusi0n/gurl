## gURL — Generates cURL from Go Gin handlers (VS Code)

gURL scans your Go workspace for Gin handlers and routes, then generates ready‑to‑run cURL commands. It understands real handler signatures and route registrations, infers JSON request bodies from your structs, and can copy the command with one click.

### Key features

- **Accurate handler detection**
  - `func (c *gin.Context)` handlers (free functions and methods)
  - Functions that return `gin.HandlerFunc` (free or with receivers), including factories that `return func(c *gin.Context) { ... }`

- **Route linking across the workspace**
  - Detects `r.GET/POST/...`, `r.Handle("METHOD", ...)`, `r.Any(...)`
  - Supports handler factories called in routes: `r.GET("/path", Handler())`
  - Resolves group prefixes: `g := r.Group("/api"); g.GET("/v1", h)

- **Smart cURL generation**
  - Extracts path parameters, query params, headers, and cookies from handler code
  - **JSON body inference**: Detects `ShouldBindJSON/BindJSON` targets, reads struct definitions and `json:"..."` tags, and emits a type‑aware sample JSON (strings, numbers, booleans, arrays, maps, pointers, `time.Time`, etc.)
  - Form and multipart bodies use sensible placeholders

- **Inline ergonomics**
  - CodeLens above each handler: “gURL: Generate cURL” and “copy” (copies directly without opening a view)
  - Overlay panel shows the generated cURL with a small “(copy)” control

## Usage

### From CodeLens (fastest)

1. Open a Go file with Gin handlers.
2. Use the CodeLens above a handler:
   - “gURL: Generate cURL” → opens the overlay with the cURL.
   - “copy” → copies the cURL directly to your clipboard.

### From the Command Palette

- “gURL: Generate cURL for Gin Handlers (Current File)” — choose a handler (and route if multiple), view the cURL overlay.
- “gURL: Generate cURL for Gin Handlers (Workspace)” — search all Go files, then choose a handler.
- “gURL: Copy cURL for Handler Under Cursor” — copy directly without opening the overlay.

## Commands

- `gurl.generateForSymbolAt` — Generate cURL for handler under cursor (used by CodeLens)
- `gurl.copyForSymbolAt` — Copy cURL for handler under cursor
- `gurl.generateForFile` — Generate for handlers in the current file
- `gurl.generateForWorkspace` — Generate for handlers across the workspace

## Settings

- `gurl.baseUrl` (string, default: `http://localhost:8080`)
  - Base URL to prepend to paths. If left as default, gURL will try to infer the actual address from calls like `engine.Run(":8080")` or `http.ListenAndServe("0.0.0.0:8080", ...)`.
- `gurl.defaultHeaders` (object)
  - Headers to include with every cURL (e.g. `{ "Accept": "application/json" }`).
- `gurl.useHttpieStyle` (boolean)
  - Reserved for future HTTPie‑style output.

## What gURL detects

- Handlers
  - `func Name(c *gin.Context) { ... }`
  - `func (h *Handler) Name(c *gin.Context) { ... }`
  - `func Name() gin.HandlerFunc { return func(c *gin.Context) { ... } }`
  - `func (h *Handler) Name() gin.HandlerFunc { return func(c *gin.Context) { ... } }`
  - Factories that return `func(c *gin.Context)` even without explicit `gin.HandlerFunc` in the signature

- Routes
  - `r.GET/POST/PUT/DELETE/PATCH/OPTIONS/HEAD("/path", Handler)`
  - `r.Handle("METHOD", "/path", Handler)`
  - `r.Any("/path", Handler)`
  - Handler factories invoked at call sites: `Handler()`
  - Group prefixes composed via `Group("/prefix")`

## JSON body inference details

gURL looks for bindings like:

```go
c.ShouldBindJSON(&Type{...})
c.BindJSON(&Type{...})
c.ShouldBindJSON(&req) // where req has a struct type
```

It then scans your workspace text for the struct definition and builds a sample JSON object using:
- `json:"name,omitempty"` tags (ignores `-`), otherwise lowerCamel of the Go field
- Type‑aware placeholders (strings, numbers, booleans, arrays, maps, pointers, `time.Time`, `json.RawMessage`)

## Troubleshooting

- CodeLens not showing?
  - Ensure the file imports `github.com/gin-gonic/gin` and the function matches one of the supported handler patterns.
- Base URL looks wrong?
  - Set `gurl.baseUrl` explicitly to override inference. Otherwise gURL uses the first detected server start.
- No routes found for a handler?
  - Ensure routes are registered via supported calls (`GET/Handle/Any`) and that handler names match.

## Limitations

- Parsing is heuristic (regex‑based). Very unconventional patterns may be missed.
- Structs defined in external modules (not opened as workspace files) won’t be introspected for JSON fields.
- Multipart body generation is placeholder‑only right now.

## Release notes

- Handler detection for context‑param, return‑type factories, and receiver methods
- Route detection including factories `Handler()` and group prefixes
- JSON struct and type‑aware body inference
- Base URL auto‑detection from `Run/RunTLS/ListenAndServe`
- CodeLens actions: generate and copy
