/* ============================================================
   InsureBot — charts.js
   Sets Chart.js global defaults tuned for InsureBot's dark/glass
   theme. Load AFTER Chart.js CDN and BEFORE admin.js.

   Also exports two helper factories:
     window.InsureBotCharts.bar(ctx, labels, data, options)
     window.InsureBotCharts.doughnut(ctx, labels, data, options)
   so admin.js can build charts without boilerplate.
   ============================================================ */

(function () {
  "use strict";

  // ── Brand palette (matches CSS vars where possible) ──
  const PALETTE = [
    "#6366f1", // indigo  — primary
    "#22d3ee", // cyan    — secondary
    "#f59e0b", // amber
    "#10b981", // emerald
    "#ef4444", // red
    "#a78bfa", // violet
    "#fb923c", // orange
    "#34d399", // green
  ];

  const FRAUD_PALETTE = {
    genuine:    "#10b981",
    suspicious: "#f59e0b",
    fraud:      "#ef4444",
  };

  // ── Shared axis / tooltip defaults ──
  const FONT_FAMILY = "'Inter', 'Segoe UI', system-ui, sans-serif";

  function applyGlobalDefaults() {
    if (!window.Chart) return; // Chart.js not loaded yet — skip

    Chart.defaults.font.family = FONT_FAMILY;
    Chart.defaults.font.size   = 13;
    Chart.defaults.color       = "rgba(255,255,255,0.65)";

    Chart.defaults.plugins.legend.labels.color     = "rgba(255,255,255,0.75)";
    Chart.defaults.plugins.legend.labels.boxWidth  = 12;
    Chart.defaults.plugins.legend.labels.padding   = 16;

    Chart.defaults.plugins.tooltip.backgroundColor = "rgba(15,15,30,0.92)";
    Chart.defaults.plugins.tooltip.titleColor      = "#fff";
    Chart.defaults.plugins.tooltip.bodyColor       = "rgba(255,255,255,0.8)";
    Chart.defaults.plugins.tooltip.borderColor     = "rgba(99,102,241,0.4)";
    Chart.defaults.plugins.tooltip.borderWidth     = 1;
    Chart.defaults.plugins.tooltip.padding         = 10;
    Chart.defaults.plugins.tooltip.cornerRadius    = 8;

    // Scales (only applied when scale is created — no error for pie/doughnut)
    Chart.defaults.scale.grid.color        = "rgba(255,255,255,0.06)";
    Chart.defaults.scale.grid.borderColor  = "rgba(255,255,255,0.08)";
    Chart.defaults.scale.ticks.color       = "rgba(255,255,255,0.5)";
  }

  // ── Light theme overrides ──
  function applyLightDefaults() {
    if (!window.Chart) return;

    Chart.defaults.color                               = "rgba(30,30,50,0.7)";
    Chart.defaults.plugins.legend.labels.color        = "rgba(30,30,50,0.85)";
    Chart.defaults.plugins.tooltip.backgroundColor    = "rgba(255,255,255,0.96)";
    Chart.defaults.plugins.tooltip.titleColor         = "#1e1e32";
    Chart.defaults.plugins.tooltip.bodyColor          = "rgba(30,30,50,0.75)";
    Chart.defaults.plugins.tooltip.borderColor        = "rgba(99,102,241,0.3)";
    Chart.defaults.scale.grid.color                   = "rgba(0,0,0,0.06)";
    Chart.defaults.scale.ticks.color                  = "rgba(30,30,50,0.55)";
  }

  // Apply correct defaults based on current theme, and re-apply on toggle
  function syncWithTheme() {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    if (isLight) {
      applyLightDefaults();
    } else {
      applyGlobalDefaults();
    }
  }

  // ── Chart factory helpers ──

  /**
   * Creates a bar chart.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string[]} labels
   * @param {number[]} data
   * @param {object}   opts  — merged into Chart config
   * @returns {Chart}
   */
  function createBar(ctx, labels, data, opts = {}) {
    syncWithTheme();
    return new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label:           opts.label || "Count",
          data,
          backgroundColor: PALETTE.slice(0, data.length),
          borderRadius:    6,
          borderSkipped:   false,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (items) => items[0].label } },
          ...(opts.plugins || {}),
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 } },
          ...(opts.scales || {}),
        },
        animation: { duration: 500 },
        ...(opts.chart || {}),
      },
    });
  }

  /**
   * Creates a doughnut chart.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string[]} labels
   * @param {number[]} data
   * @param {object}   opts
   * @returns {Chart}
   */
  function createDoughnut(ctx, labels, data, opts = {}) {
    syncWithTheme();

    // Use fraud palette if labels match; otherwise generic
    const bg = labels.map((l) =>
      FRAUD_PALETTE[l.toLowerCase()] || PALETTE[labels.indexOf(l) % PALETTE.length]
    );

    return new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bg,
          borderColor:     "rgba(0,0,0,0.15)",
          borderWidth:     2,
          hoverOffset:     6,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        cutout:              "68%",
        plugins: {
          legend: {
            display:  true,
            position: "bottom",
          },
          ...(opts.plugins || {}),
        },
        animation: { duration: 500 },
        ...(opts.chart || {}),
      },
    });
  }

  // ── Init ──

  document.addEventListener("DOMContentLoaded", () => {
    if (!window.Chart) {
      console.warn("InsureBot charts.js: Chart.js not found. Load it before charts.js.");
      return;
    }
    syncWithTheme();

    // Re-sync if user switches theme at runtime
    const observer = new MutationObserver(() => syncWithTheme());
    observer.observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-theme"],
    });
  });

  window.InsureBotCharts = {
    palette:       PALETTE,
    fraudPalette:  FRAUD_PALETTE,
    bar:           createBar,
    doughnut:      createDoughnut,
    syncWithTheme,
  };
})();