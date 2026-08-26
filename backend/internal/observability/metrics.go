package observability

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	requests          *prometheus.CounterVec
	duration          *prometheus.HistogramVec
	inFlight          prometheus.Gauge
	searchRejections  prometheus.Counter
	expositionHandler http.Handler
}

func NewMetrics() *Metrics {
	registry := prometheus.NewRegistry()
	metrics := &Metrics{
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "blog_studio",
			Subsystem: "http",
			Name:      "requests_total",
			Help:      "Total HTTP requests handled by route template and status.",
		}, []string{"method", "route", "status"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: "blog_studio",
			Subsystem: "http",
			Name:      "request_duration_seconds",
			Help:      "HTTP request duration by route template.",
			Buckets:   prometheus.DefBuckets,
		}, []string{"method", "route"}),
		inFlight: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "blog_studio",
			Subsystem: "http",
			Name:      "requests_in_flight",
			Help:      "Current number of HTTP requests being handled.",
		}),
		searchRejections: prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "blog_studio",
			Subsystem: "public_search",
			Name:      "rate_limit_rejections_total",
			Help:      "Total anonymous public search requests rejected by rate limiting.",
		}),
	}
	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		metrics.requests,
		metrics.duration,
		metrics.inFlight,
		metrics.searchRejections,
	)
	metrics.expositionHandler = promhttp.HandlerFor(registry, promhttp.HandlerOpts{
		EnableOpenMetrics: true,
	})
	return metrics
}

func (m *Metrics) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		m.inFlight.Inc()
		defer m.inFlight.Dec()

		c.Next()

		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		method := c.Request.Method
		m.requests.WithLabelValues(method, route, strconv.Itoa(c.Writer.Status())).Inc()
		m.duration.WithLabelValues(method, route).Observe(time.Since(started).Seconds())
	}
}

func (m *Metrics) Handler(c *gin.Context) {
	m.expositionHandler.ServeHTTP(c.Writer, c.Request)
}

func (m *Metrics) ObservePublicSearchRateLimitRejection() {
	m.searchRejections.Inc()
}
