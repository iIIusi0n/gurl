package gurl

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

type CurlLoggerConfig struct {
	Writer          io.Writer
	StatusFilter    func(int) bool
	MultiLine       bool
	IncludeResponse bool
	HideHeaders     []string
	MaxBodySize     int64
}

type DefaultConfig struct{}

func (DefaultConfig) Writer() io.Writer {
	return os.Stdout
}

func (DefaultConfig) StatusFilter() func(int) bool {
	return func(status int) bool {
		return status >= 400
	}
}

func (DefaultConfig) MultiLine() bool {
	return false
}

func (DefaultConfig) IncludeResponse() bool {
	return false
}

func (DefaultConfig) HideHeaders() []string {
	return []string{"Authorization", "Cookie", "X-Api-Key"}
}

func (DefaultConfig) MaxBodySize() int64 {
	return 10 * 1024
}

func CurlLogger(config ...CurlLoggerConfig) gin.HandlerFunc {
	cfg := DefaultConfig{}

	var writer io.Writer = cfg.Writer()
	var statusFilter func(int) bool = cfg.StatusFilter()
	var multiLine bool = cfg.MultiLine()
	var includeResponse bool = cfg.IncludeResponse()
	var hideHeaders []string = cfg.HideHeaders()
	var maxBodySize int64 = cfg.MaxBodySize()

	if len(config) > 0 {
		c := config[0]
		if c.Writer != nil {
			writer = c.Writer
		}
		if c.StatusFilter != nil {
			statusFilter = c.StatusFilter
		}
		multiLine = c.MultiLine
		includeResponse = c.IncludeResponse
		if c.HideHeaders != nil {
			hideHeaders = c.HideHeaders
		}
		if c.MaxBodySize > 0 {
			maxBodySize = c.MaxBodySize
		}
	}

	hideHeadersMap := make(map[string]bool)
	for _, header := range hideHeaders {
		hideHeadersMap[strings.ToLower(header)] = true
	}

	return func(c *gin.Context) {
		if !gin.IsDebugging() {
			c.Next()
			return
		}

		var bodyBytes []byte
		if c.Request.Body != nil {
			bodyBytes, _ = io.ReadAll(io.LimitReader(c.Request.Body, maxBodySize))
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}

		var responseBodyBytes []byte
		var responseWriter *responseBodyWriter
		if includeResponse {
			responseWriter = &responseBodyWriter{
				ResponseWriter: c.Writer,
				body:           &bytes.Buffer{},
			}
			c.Writer = responseWriter
		}

		c.Next()

		status := c.Writer.Status()
		if statusFilter != nil && !statusFilter(status) {
			return
		}

		curlCmd := buildCurlCommand(c.Request, bodyBytes, hideHeadersMap, multiLine)

		if includeResponse && responseWriter != nil {
			responseBodyBytes = responseWriter.body.Bytes()
			if len(responseBodyBytes) > int(maxBodySize) {
				responseBodyBytes = responseBodyBytes[:maxBodySize]
			}
		}

		logOutput := formatLogOutput(curlCmd, status, responseBodyBytes, multiLine)
		fmt.Fprint(writer, logOutput)
	}
}

type responseBodyWriter struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (w *responseBodyWriter) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

func buildCurlCommand(req *http.Request, bodyBytes []byte, hideHeaders map[string]bool, multiLine bool) string {
	var parts []string

	if multiLine {
		parts = append(parts, "curl")
	} else {
		parts = append(parts, "curl")
	}

	scheme := "http"
	if req.TLS != nil {
		scheme = "https"
	}

	fullURL := fmt.Sprintf("%s://%s%s", scheme, req.Host, req.RequestURI)

	if multiLine {
		parts = append(parts, fmt.Sprintf(" \\\n  -X %s", req.Method))
		parts = append(parts, fmt.Sprintf(" \\\n  '%s'", fullURL))
	} else {
		parts = append(parts, fmt.Sprintf("-X %s", req.Method))
		parts = append(parts, fmt.Sprintf("'%s'", fullURL))
	}

	var headers []string
	for name, values := range req.Header {
		if hideHeaders[strings.ToLower(name)] {
			continue
		}
		for _, value := range values {
			headers = append(headers, fmt.Sprintf("%s: %s", name, value))
		}
	}

	sort.Strings(headers)

	for _, header := range headers {
		if multiLine {
			parts = append(parts, fmt.Sprintf(" \\\n  -H '%s'", header))
		} else {
			parts = append(parts, fmt.Sprintf("-H '%s'", header))
		}
	}

	if len(bodyBytes) > 0 {
		body := string(bodyBytes)
		body = strings.ReplaceAll(body, "'", "'\"'\"'")

		if multiLine {
			if isJSONContent(req.Header.Get("Content-Type")) {
				parts = append(parts, fmt.Sprintf(" \\\n  --data '%s'", body))
			} else {
				parts = append(parts, fmt.Sprintf(" \\\n  --data-raw '%s'", body))
			}
		} else {
			if isJSONContent(req.Header.Get("Content-Type")) {
				parts = append(parts, fmt.Sprintf("--data '%s'", body))
			} else {
				parts = append(parts, fmt.Sprintf("--data-raw '%s'", body))
			}
		}
	}

	if multiLine {
		return strings.Join(parts, "")
	}
	return strings.Join(parts, " ")
}

func isJSONContent(contentType string) bool {
	return strings.Contains(strings.ToLower(contentType), "application/json")
}

func formatLogOutput(curlCmd string, status int, responseBody []byte, multiLine bool) string {
	var output strings.Builder

	if multiLine {
		output.WriteString("=== cURL Command ===\n")
		output.WriteString(curlCmd)
		output.WriteString("\n")
		output.WriteString(fmt.Sprintf("=== Response Status: %d ===\n", status))
		if len(responseBody) > 0 {
			output.WriteString("=== Response Body ===\n")
			output.WriteString(string(responseBody))
			output.WriteString("\n")
		}
		output.WriteString("==================\n\n")
	} else {
		output.WriteString(fmt.Sprintf("[STATUS:%d] %s", status, curlCmd))
		if len(responseBody) > 0 {
			truncatedBody := string(responseBody)
			if len(truncatedBody) > 100 {
				truncatedBody = truncatedBody[:100] + "..."
			}
			truncatedBody = strings.ReplaceAll(truncatedBody, "\n", "\\n")
			output.WriteString(fmt.Sprintf(" | Response: %s", truncatedBody))
		}
		output.WriteString("\n")
	}

	return output.String()
}

func CurlLoggerWithWriter(writer io.Writer) gin.HandlerFunc {
	return CurlLogger(CurlLoggerConfig{Writer: writer})
}

func CurlLoggerWithStatusFilter(filter func(int) bool) gin.HandlerFunc {
	return CurlLogger(CurlLoggerConfig{StatusFilter: filter})
}

func CurlLoggerMultiLine() gin.HandlerFunc {
	return CurlLogger(CurlLoggerConfig{MultiLine: true})
}

func CurlLoggerWithResponse() gin.HandlerFunc {
	return CurlLogger(CurlLoggerConfig{IncludeResponse: true, MultiLine: true})
}
