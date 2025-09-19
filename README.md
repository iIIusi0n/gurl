# gurl - Gin cURL Logging Middleware

A debugging middleware for Gin that logs HTTP requests as executable cURL commands.

## Features

- **Debug Mode Only**: Automatically disabled in production (`gin.ReleaseMode`)
- **Configurable Logging**: Filter by status codes, customize output format
- **Multiple Formats**: One-line compact or multi-line readable output
- **Response Capture**: Optional response body logging
- **Memory Efficient**: Configurable body size limits

## Installation

```bash
go get github.com/iIIusi0n/gurl
```

## Basic Usage

```go
package main

import (
    "github.com/gin-gonic/gin"
    "github.com/iIIusi0n/gurl"
)

func main() {
    gin.SetMode(gin.DebugMode) // Required for middleware to work

    r := gin.Default()

    // Basic usage - logs errors (status >= 400) to stdout
    r.Use(gurl.CurlLogger())

    r.GET("/ping", func(c *gin.Context) {
        c.JSON(200, gin.H{"message": "pong"})
    })

    r.Run(":8080")
}
```

## Configuration

```go
r.Use(gurl.CurlLogger(gurl.CurlLoggerConfig{
    Writer: os.Stderr,
    StatusFilter: func(status int) bool {
        return status >= 400 || status == 201
    },
    MultiLine: true,
    IncludeResponse: true,
    HideHeaders: []string{"X-Secret"},
    MaxBodySize: 1024,
}))
```

## Convenience Functions

```go
r.Use(gurl.CurlLoggerWithWriter(logFile))

r.Use(gurl.CurlLoggerWithStatusFilter(func(status int) bool {
    return status == 200
}))

r.Use(gurl.CurlLoggerMultiLine())

r.Use(gurl.CurlLoggerWithResponse())
```

## Output Examples

### Single Line Format (Default)
```
[STATUS:500] curl -X POST 'http://localhost:8080/users' -H 'Content-Type: application/json' --data '{"name":"John","email":"john@example.com"}'
```

### Multi-Line Format
```
=== cURL Command ===
curl \
  -X POST \
  'http://localhost:8080/users' \
  -H 'Content-Type: application/json' \
  --data '{"name":"John","email":"john@example.com"}'
=== Response Status: 500 ===
==================
```

## License

MIT License