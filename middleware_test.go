package gurl

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func init() {
	gin.SetMode(gin.DebugMode)
}

func TestCurlLogger_BasicGETRequest(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{Writer: &logOutput}))
	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "success"})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("User-Agent", "test-client")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, 200, w.Code)
	assert.Empty(t, logOutput.String())

	t.Log(logOutput.String())
}

func TestCurlLogger_ErrorStatusLogging(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{Writer: &logOutput}))
	router.GET("/error", func(c *gin.Context) {
		c.JSON(500, gin.H{"error": "internal error"})
	})

	req := httptest.NewRequest("GET", "/error", nil)
	req.Header.Set("User-Agent", "test-client")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, 500, w.Code)
	output := logOutput.String()
	assert.Contains(t, output, "curl")
	assert.Contains(t, output, "-X GET")
	assert.Contains(t, output, "/error")
	assert.Contains(t, output, "[STATUS:500]")

	t.Log(output)
}

func TestCurlLogger_POSTWithJSONBody(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer:       &logOutput,
		StatusFilter: func(status int) bool { return true },
	}))
	router.POST("/users", func(c *gin.Context) {
		c.JSON(201, gin.H{"id": 1})
	})

	payload := map[string]any{
		"name":  "John Doe",
		"email": "john@example.com",
	}
	jsonData, _ := json.Marshal(payload)

	req := httptest.NewRequest("POST", "/users", bytes.NewBuffer(jsonData))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "test-client")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, 201, w.Code)
	output := logOutput.String()
	assert.Contains(t, output, "curl")
	assert.Contains(t, output, "-X POST")
	assert.Contains(t, output, "--data")
	assert.Contains(t, output, "John Doe")
	assert.Contains(t, output, "application/json")

	t.Log(output)
}

func TestCurlLogger_MultiLineFormat(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer:       &logOutput,
		StatusFilter: func(status int) bool { return true },
		MultiLine:    true,
	}))
	router.POST("/data", func(c *gin.Context) {
		c.JSON(200, gin.H{"received": true})
	})

	req := httptest.NewRequest("POST", "/data", strings.NewReader("test data"))
	req.Header.Set("Content-Type", "text/plain")
	req.Header.Set("Authorization", "Bearer token123")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	output := logOutput.String()
	assert.Contains(t, output, "=== cURL Command ===")
	assert.Contains(t, output, "\\\n")
	assert.Contains(t, output, "=== Response Status: 200 ===")
	assert.NotContains(t, output, "Bearer token123")

	t.Log(output)
}

func TestCurlLogger_CustomStatusFilter(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer: &logOutput,
		StatusFilter: func(status int) bool {
			return status == 201 || status >= 400
		},
	}))

	router.GET("/ok", func(c *gin.Context) { c.JSON(200, gin.H{}) })
	router.POST("/created", func(c *gin.Context) { c.JSON(201, gin.H{}) })
	router.GET("/error", func(c *gin.Context) { c.JSON(404, gin.H{}) })

	tests := []struct {
		method    string
		path      string
		expected  int
		shouldLog bool
	}{
		{"GET", "/ok", 200, false},
		{"POST", "/created", 201, true},
		{"GET", "/error", 404, true},
	}

	for _, tt := range tests {
		logOutput.Reset()
		req := httptest.NewRequest(tt.method, tt.path, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, tt.expected, w.Code)
		if tt.shouldLog {
			assert.NotEmpty(t, logOutput.String(), "Should log for %s %s", tt.method, tt.path)
		} else {
			assert.Empty(t, logOutput.String(), "Should not log for %s %s", tt.method, tt.path)
		}
	}

	t.Log(logOutput.String())
}

func TestCurlLogger_HideHeaders(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer:       &logOutput,
		StatusFilter: func(status int) bool { return true },
		HideHeaders:  []string{"Authorization", "X-Secret"},
	}))
	router.GET("/secure", func(c *gin.Context) {
		c.JSON(200, gin.H{})
	})

	req := httptest.NewRequest("GET", "/secure", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	req.Header.Set("X-Secret", "very-secret")
	req.Header.Set("User-Agent", "test-client")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	output := logOutput.String()
	assert.NotContains(t, output, "secret-token")
	assert.NotContains(t, output, "very-secret")
	assert.Contains(t, output, "User-Agent")

	t.Log(output)
}

func TestCurlLogger_FormData(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer:       &logOutput,
		StatusFilter: func(status int) bool { return true },
	}))
	router.POST("/form", func(c *gin.Context) {
		c.JSON(200, gin.H{})
	})

	formData := "username=testuser&password=testpass"
	req := httptest.NewRequest("POST", "/form", strings.NewReader(formData))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	output := logOutput.String()
	assert.Contains(t, output, "--data-raw")
	assert.Contains(t, output, "username=testuser")
	assert.Contains(t, output, "application/x-www-form-urlencoded")

	t.Log(output)
}

func TestCurlLogger_WithQueryParams(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer:       &logOutput,
		StatusFilter: func(status int) bool { return true },
	}))
	router.GET("/search", func(c *gin.Context) {
		c.JSON(200, gin.H{})
	})

	req := httptest.NewRequest("GET", "/search?q=golang&limit=10&sort=date", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	output := logOutput.String()
	assert.Contains(t, output, "/search?q=golang&limit=10&sort=date")

	t.Log(output)
}

func TestCurlLogger_LargeBody(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer:       &logOutput,
		StatusFilter: func(status int) bool { return true },
		MaxBodySize:  50,
	}))
	router.POST("/upload", func(c *gin.Context) {
		c.JSON(200, gin.H{})
	})

	largeData := strings.Repeat("abcdefghij", 20)
	req := httptest.NewRequest("POST", "/upload", strings.NewReader(largeData))
	req.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	output := logOutput.String()
	assert.Contains(t, output, "--data-raw")
	assert.NotContains(t, output, largeData)

	t.Log(output)
}

func TestCurlLogger_WithResponse(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer:          &logOutput,
		StatusFilter:    func(status int) bool { return true },
		IncludeResponse: true,
		MultiLine:       true,
	}))
	router.GET("/api/data", func(c *gin.Context) {
		c.JSON(200, gin.H{"data": "response body", "status": "ok"})
	})

	req := httptest.NewRequest("GET", "/api/data", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	output := logOutput.String()
	assert.Contains(t, output, "=== Response Body ===")
	assert.Contains(t, output, "response body")
	assert.Contains(t, output, "status")

	t.Log(output)
}

func TestCurlLogger_SpecialCharacters(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer:       &logOutput,
		StatusFilter: func(status int) bool { return true },
	}))
	router.POST("/special", func(c *gin.Context) {
		c.JSON(200, gin.H{})
	})

	specialData := `{"message": "Hello 'world' with \"quotes\" and $pecial ch@rs!"}`
	req := httptest.NewRequest("POST", "/special", strings.NewReader(specialData))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	output := logOutput.String()
	assert.Contains(t, output, "--data")
	assert.Contains(t, output, "Hello")

	t.Log(output)
}

func TestCurlLogger_DebugModeCheck(t *testing.T) {
	originalMode := gin.Mode()
	defer gin.SetMode(originalMode)

	var logOutput bytes.Buffer

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer:       &logOutput,
		StatusFilter: func(status int) bool { return true },
	}))
	router.GET("/test", func(c *gin.Context) {
		c.JSON(500, gin.H{})
	})

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Empty(t, logOutput.String(), "Should not log when not in debug mode")

	gin.SetMode(gin.DebugMode)
	logOutput.Reset()
	router.ServeHTTP(w, req)

	assert.NotEmpty(t, logOutput.String(), "Should log when in debug mode")

	t.Log(logOutput.String())
}

func TestCurlLogger_ConvenienceFunctions(t *testing.T) {
	t.Run("CurlLoggerWithWriter", func(t *testing.T) {
		var logOutput bytes.Buffer
		router := gin.New()
		router.Use(CurlLoggerWithWriter(&logOutput))
		router.GET("/test", func(c *gin.Context) {
			c.JSON(500, gin.H{"error": "test"})
		})

		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Contains(t, logOutput.String(), "curl")
	})

	t.Run("CurlLoggerWithStatusFilter", func(t *testing.T) {
		var logOutput bytes.Buffer
		router := gin.New()
		router.Use(CurlLogger(CurlLoggerConfig{
			Writer:       &logOutput,
			StatusFilter: func(status int) bool { return status == 200 },
		}))
		router.GET("/test", func(c *gin.Context) {
			c.JSON(200, gin.H{"test": true})
		})

		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Contains(t, logOutput.String(), "curl")
	})

	t.Run("CurlLoggerMultiLine", func(t *testing.T) {
		var logOutput bytes.Buffer
		router := gin.New()
		router.Use(CurlLogger(CurlLoggerConfig{
			Writer:       &logOutput,
			StatusFilter: func(status int) bool { return true },
			MultiLine:    true,
		}))
		router.GET("/test", func(c *gin.Context) {
			c.JSON(200, gin.H{"test": true})
		})

		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Contains(t, logOutput.String(), "=== cURL Command ===")
	})

	t.Run("CurlLoggerWithResponse", func(t *testing.T) {
		var logOutput bytes.Buffer
		router := gin.New()
		router.Use(CurlLogger(CurlLoggerConfig{
			Writer:          &logOutput,
			StatusFilter:    func(status int) bool { return true },
			IncludeResponse: true,
			MultiLine:       true,
		}))
		router.GET("/test", func(c *gin.Context) {
			c.JSON(200, gin.H{"test": true})
		})

		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Contains(t, logOutput.String(), "=== Response Body ===")
	})
}

func TestCurlLogger_HTTPSRequest(t *testing.T) {
	var logOutput bytes.Buffer

	router := gin.New()
	router.Use(CurlLogger(CurlLoggerConfig{
		Writer:       &logOutput,
		StatusFilter: func(status int) bool { return true },
	}))
	router.GET("/secure", func(c *gin.Context) {
		c.JSON(200, gin.H{})
	})

	req := httptest.NewRequest("GET", "https://example.com/secure", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	output := logOutput.String()
	assert.Contains(t, output, "/secure")
	t.Log(output)
}
