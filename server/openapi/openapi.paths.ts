/** AUTO-GENERATED — nicht manuell bearbeiten. Ausführen: `npm run openapi:generate`. */
export const openApiPaths = {
  "/api/accounting/confirm": {
    "post": {
      "tags": [
        "accounting"
      ],
      "summary": "POST /api/accounting/confirm",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/accounting/shop-fakturen/import": {
    "post": {
      "tags": [
        "accounting"
      ],
      "summary": "POST /api/accounting/shop-fakturen/import",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/accounting/upload": {
    "post": {
      "tags": [
        "accounting"
      ],
      "summary": "POST /api/accounting/upload",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/analyze-sentiment": {
    "post": {
      "tags": [
        "ai"
      ],
      "summary": "POST /api/ai/analyze-sentiment",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/cross-selling/insights": {
    "get": {
      "tags": [
        "ai"
      ],
      "summary": "GET /api/ai/cross-selling/insights",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/cross-selling/recommendations": {
    "get": {
      "tags": [
        "ai"
      ],
      "summary": "GET /api/ai/cross-selling/recommendations",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/cross-selling/rules": {
    "get": {
      "tags": [
        "ai"
      ],
      "summary": "GET /api/ai/cross-selling/rules",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/cross-selling/run": {
    "post": {
      "tags": [
        "ai"
      ],
      "summary": "POST /api/ai/cross-selling/run",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/cross-selling/status": {
    "get": {
      "tags": [
        "ai"
      ],
      "summary": "GET /api/ai/cross-selling/status",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/generate-replies": {
    "post": {
      "tags": [
        "ai"
      ],
      "summary": "POST /api/ai/generate-replies",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/improve-text": {
    "post": {
      "tags": [
        "ai"
      ],
      "summary": "POST /api/ai/improve-text",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/insights": {
    "get": {
      "tags": [
        "ai"
      ],
      "summary": "GET /api/ai/insights",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/offers/insights": {
    "get": {
      "tags": [
        "ai"
      ],
      "summary": "GET /api/ai/offers/insights",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/offers/run": {
    "post": {
      "tags": [
        "ai"
      ],
      "summary": "POST /api/ai/offers/run",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ai/suggest-categories": {
    "post": {
      "tags": [
        "ai"
      ],
      "summary": "POST /api/ai/suggest-categories",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/category-sales": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/category-sales",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/google/ads": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/google/ads",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/google/ga4": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/google/ga4",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/nl-query": {
    "post": {
      "tags": [
        "analytics"
      ],
      "summary": "POST /api/analytics/nl-query",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/order-status": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/order-status",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/payment-status": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/payment-status",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/product-activity-trend": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/product-activity-trend",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/product-data-quality": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/product-data-quality",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/product-overview": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/product-overview",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/product-performance": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/product-performance",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/sales-trend": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/sales-trend",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/shipping-times": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/shipping-times",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/suggested-questions": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/suggested-questions",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/analytics/summary": {
    "get": {
      "tags": [
        "analytics"
      ],
      "summary": "GET /api/analytics/summary",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/attachments/{attachmentId}": {
    "delete": {
      "tags": [
        "attachments"
      ],
      "summary": "DELETE /api/attachments/{attachmentId}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/attachments/{attachmentId}/download": {
    "get": {
      "tags": [
        "attachments"
      ],
      "summary": "GET /api/attachments/{attachmentId}/download",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/attachments/{attachmentId}/preview": {
    "get": {
      "tags": [
        "attachments"
      ],
      "summary": "GET /api/attachments/{attachmentId}/preview",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/auth/login": {
    "post": {
      "tags": [
        "auth"
      ],
      "summary": "POST /api/auth/login",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      },
      "security": []
    }
  },
  "/api/auth/logout": {
    "post": {
      "tags": [
        "auth"
      ],
      "summary": "POST /api/auth/logout",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/auth/m365/callback": {
    "get": {
      "tags": [
        "auth"
      ],
      "summary": "GET /api/auth/m365/callback",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/auth/m365/device/poll": {
    "post": {
      "tags": [
        "auth"
      ],
      "summary": "POST /api/auth/m365/device/poll",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/auth/m365/device/start": {
    "post": {
      "tags": [
        "auth"
      ],
      "summary": "POST /api/auth/m365/device/start",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/auth/m365/start": {
    "get": {
      "tags": [
        "auth"
      ],
      "summary": "GET /api/auth/m365/start",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/auth/me": {
    "get": {
      "tags": [
        "auth"
      ],
      "summary": "GET /api/auth/me",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/auth/token": {
    "get": {
      "tags": [
        "auth"
      ],
      "summary": "GET /api/auth/token",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/automation-rules": {
    "get": {
      "tags": [
        "automation-rules"
      ],
      "summary": "GET /api/automation-rules",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "automation-rules"
      ],
      "summary": "POST /api/automation-rules",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/automation-rules/{id}": {
    "delete": {
      "tags": [
        "automation-rules"
      ],
      "summary": "DELETE /api/automation-rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "get": {
      "tags": [
        "automation-rules"
      ],
      "summary": "GET /api/automation-rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "automation-rules"
      ],
      "summary": "PATCH /api/automation-rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/automation-rules/{id}/executions": {
    "get": {
      "tags": [
        "automation-rules"
      ],
      "summary": "GET /api/automation-rules/{id}/executions",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/automation-rules/{id}/toggle": {
    "post": {
      "tags": [
        "automation-rules"
      ],
      "summary": "POST /api/automation-rules/{id}/toggle",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/b2b/entities": {
    "get": {
      "tags": [
        "b2b"
      ],
      "summary": "GET /api/b2b/entities",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/b2b/offer-status-mapping": {
    "get": {
      "tags": [
        "b2b"
      ],
      "summary": "GET /api/b2b/offer-status-mapping",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/b2b/offer-statuses": {
    "get": {
      "tags": [
        "b2b"
      ],
      "summary": "GET /api/b2b/offer-statuses",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/b2b-entity-mapping": {
    "get": {
      "tags": ["b2b", "settings"],
      "summary": "GET /api/settings/b2b-entity-mapping",
      "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } }
    },
    "post": {
      "tags": ["b2b", "settings"],
      "summary": "POST /api/settings/b2b-entity-mapping",
      "responses": { "200": { "description": "OK" }, "400": { "description": "Bad request" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } }
    }
  },
  "/api/b2b/companies": {
    "get": { "tags": ["b2b"], "summary": "GET /api/b2b/companies", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } }
  },
  "/api/b2b/employees": {
    "get": { "tags": ["b2b"], "summary": "GET /api/b2b/employees", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } }
  },
  "/api/b2b/roles": {
    "get": { "tags": ["b2b"], "summary": "GET /api/b2b/roles", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } }
  },
  "/api/b2b/budgets": {
    "get": { "tags": ["b2b"], "summary": "GET /api/b2b/budgets", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } }
  },
  "/api/b2b/approvals": {
    "get": { "tags": ["b2b"], "summary": "GET /api/b2b/approvals", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } }
  },
  "/api/b2b/assortments": {
    "get": { "tags": ["b2b"], "summary": "GET /api/b2b/assortments", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } }
  },
  "/api/b2b/customer-skus": {
    "get": { "tags": ["b2b"], "summary": "GET /api/b2b/customer-skus", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } },
    "post": { "tags": ["b2b"], "summary": "POST /api/b2b/customer-skus", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } }
  },
  "/api/b2b/shopping-lists": {
    "get": { "tags": ["b2b"], "summary": "GET /api/b2b/shopping-lists", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } }
  },
  "/api/b2b/quick-order/match": {
    "post": { "tags": ["b2b"], "summary": "POST /api/b2b/quick-order/match", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } }
  },
  "/api/b2b/exploded-views": {
    "get": { "tags": ["b2b"], "summary": "GET /api/b2b/exploded-views", "responses": { "200": { "description": "OK" }, "401": { "description": "Unauthorized" }, "403": { "description": "Forbidden" } } }
  },
  "/api/bundles": {
    "get": {
      "tags": [
        "bundles"
      ],
      "summary": "GET /api/bundles",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "bundles"
      ],
      "summary": "POST /api/bundles",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/bundles/{id}": {
    "delete": {
      "tags": [
        "bundles"
      ],
      "summary": "DELETE /api/bundles/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "bundles"
      ],
      "summary": "PATCH /api/bundles/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/carriers": {
    "get": {
      "tags": [
        "carriers"
      ],
      "summary": "GET /api/carriers",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "carriers"
      ],
      "summary": "POST /api/carriers",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/carriers/{id}": {
    "delete": {
      "tags": [
        "carriers"
      ],
      "summary": "DELETE /api/carriers/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/categories": {
    "get": {
      "tags": [
        "categories"
      ],
      "summary": "GET /api/categories",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/commercial-agent/learning-feedback": {
    "post": {
      "tags": [
        "commercial-agent"
      ],
      "summary": "POST /api/commercial-agent/learning-feedback",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/commercial-agent/learning-stats": {
    "get": {
      "tags": [
        "commercial-agent"
      ],
      "summary": "GET /api/commercial-agent/learning-stats",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/commercial-agent/process": {
    "post": {
      "tags": [
        "commercial-agent"
      ],
      "summary": "POST /api/commercial-agent/process",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/commercial-drafts/upload": {
    "post": {
      "tags": [
        "commercial-drafts"
      ],
      "summary": "POST /api/commercial-drafts/upload",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/adapter/submit-transfer": {
    "post": {
      "tags": [
        "cpq-core"
      ],
      "summary": "POST /api/cpq-core/adapter/submit-transfer",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/data-quality/check": {
    "get": {
      "tags": [
        "cpq-core"
      ],
      "summary": "GET /api/cpq-core/data-quality/check",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/kpis/report": {
    "get": {
      "tags": [
        "cpq-core"
      ],
      "summary": "GET /api/cpq-core/kpis/report",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/monitoring/collector": {
    "get": {
      "tags": [
        "cpq-core"
      ],
      "summary": "GET /api/cpq-core/monitoring/collector",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/monitoring/snapshot": {
    "get": {
      "tags": [
        "cpq-core"
      ],
      "summary": "GET /api/cpq-core/monitoring/snapshot",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/price": {
    "post": {
      "tags": [
        "cpq-core"
      ],
      "summary": "POST /api/cpq-core/price",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/review-queue": {
    "get": {
      "tags": [
        "cpq-core"
      ],
      "summary": "GET /api/cpq-core/review-queue",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/review-queue/{id}": {
    "get": {
      "tags": [
        "cpq-core"
      ],
      "summary": "GET /api/cpq-core/review-queue/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/review-queue/{id}/status": {
    "put": {
      "tags": [
        "cpq-core"
      ],
      "summary": "PUT /api/cpq-core/review-queue/{id}/status",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/submit": {
    "post": {
      "tags": [
        "cpq-core"
      ],
      "summary": "POST /api/cpq-core/submit",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq-core/validate": {
    "post": {
      "tags": [
        "cpq-core"
      ],
      "summary": "POST /api/cpq-core/validate",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/component-types": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/admin/component-types",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/discount-levels": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/admin/discount-levels",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/admin/discount-levels",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/discount-levels/{id}": {
    "delete": {
      "tags": [
        "cpq"
      ],
      "summary": "DELETE /api/cpq/admin/discount-levels/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "put": {
      "tags": [
        "cpq"
      ],
      "summary": "PUT /api/cpq/admin/discount-levels/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/mappings": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/admin/mappings",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/rules": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/admin/rules",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/admin/rules",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/rules/{id}": {
    "delete": {
      "tags": [
        "cpq"
      ],
      "summary": "DELETE /api/cpq/admin/rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "put": {
      "tags": [
        "cpq"
      ],
      "summary": "PUT /api/cpq/admin/rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/rules/{id}/impact": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/admin/rules/{id}/impact",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/rules/{id}/rollback/{version}": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/admin/rules/{id}/rollback/{version}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/rules/{id}/versions": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/admin/rules/{id}/versions",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/rules/preview": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/admin/rules/preview",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/admin/sync-status": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/admin/sync-status",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/cart/transfer": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/cart/transfer",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/configurations": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/configurations",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/configurations/{id}": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/configurations/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/configure": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/configure",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/cross-selling": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/cross-selling",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/discount-levels": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/discount-levels",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/discount-levels/evaluate": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/discount-levels/evaluate",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/glb-resolve": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/glb-resolve",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/offers/{id}/approval-status": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/offers/{id}/approval-status",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/offers/{id}/approve": {
    "put": {
      "tags": [
        "cpq"
      ],
      "summary": "PUT /api/cpq/offers/{id}/approve",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/offers/{id}/request-approval": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/offers/{id}/request-approval",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/preview/scene": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/preview/scene",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/product-mappings/{id}/geometry": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/product-mappings/{id}/geometry",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "put": {
      "tags": [
        "cpq"
      ],
      "summary": "PUT /api/cpq/product-mappings/{id}/geometry",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/reporting/discount-overview": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/reporting/discount-overview",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/systems": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/systems",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/systems",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/systems/{id}": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/systems/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/systems/{id}/bill-of-materials": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/systems/{id}/bill-of-materials",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/systems/{id}/components": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/systems/{id}/components",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/systems/{id}/options": {
    "get": {
      "tags": [
        "cpq"
      ],
      "summary": "GET /api/cpq/systems/{id}/options",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cpq/validate-cart": {
    "post": {
      "tags": [
        "cpq"
      ],
      "summary": "POST /api/cpq/validate-cart",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/assignees": {
    "get": {
      "tags": [
        "crm"
      ],
      "summary": "GET /api/crm/assignees",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/assignments": {
    "get": {
      "tags": [
        "crm"
      ],
      "summary": "GET /api/crm/assignments",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "crm"
      ],
      "summary": "POST /api/crm/assignments",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/assignments/{id}/approve": {
    "post": {
      "tags": [
        "crm"
      ],
      "summary": "POST /api/crm/assignments/{id}/approve",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/assignments/{id}/reject": {
    "post": {
      "tags": [
        "crm"
      ],
      "summary": "POST /api/crm/assignments/{id}/reject",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/customers": {
    "get": {
      "tags": [
        "crm"
      ],
      "summary": "GET /api/crm/customers",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/customers/{id}/individual-prices": {
    "get": {
      "tags": [
        "crm"
      ],
      "summary": "GET /api/crm/customers/{id}/individual-prices",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/customers/{id}/interactions": {
    "post": {
      "tags": [
        "crm"
      ],
      "summary": "POST /api/crm/customers/{id}/interactions",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/customers/{id}/match": {
    "get": {
      "tags": [
        "crm"
      ],
      "summary": "GET /api/crm/customers/{id}/match",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/customers/{id}/overview": {
    "get": {
      "tags": [
        "crm"
      ],
      "summary": "GET /api/crm/customers/{id}/overview",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/customers/individual-prices-index": {
    "get": {
      "tags": [
        "crm"
      ],
      "summary": "GET /api/crm/customers/individual-prices-index",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/customers/merge": {
    "post": {
      "tags": [
        "crm"
      ],
      "summary": "POST /api/crm/customers/merge",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/customers/resolve": {
    "get": {
      "tags": [
        "crm"
      ],
      "summary": "GET /api/crm/customers/resolve",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/discount-requests": {
    "get": {
      "tags": [
        "crm"
      ],
      "summary": "GET /api/crm/discount-requests",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "crm"
      ],
      "summary": "POST /api/crm/discount-requests",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/discount-requests/{id}/approve": {
    "post": {
      "tags": [
        "crm"
      ],
      "summary": "POST /api/crm/discount-requests/{id}/approve",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/crm/discount-requests/{id}/reject": {
    "post": {
      "tags": [
        "crm"
      ],
      "summary": "POST /api/crm/discount-requests/{id}/reject",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling-rules": {
    "get": {
      "tags": [
        "cross-selling-rules"
      ],
      "summary": "GET /api/cross-selling-rules",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "cross-selling-rules"
      ],
      "summary": "POST /api/cross-selling-rules",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling-rules/{id}": {
    "delete": {
      "tags": [
        "cross-selling-rules"
      ],
      "summary": "DELETE /api/cross-selling-rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "get": {
      "tags": [
        "cross-selling-rules"
      ],
      "summary": "GET /api/cross-selling-rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "put": {
      "tags": [
        "cross-selling-rules"
      ],
      "summary": "PUT /api/cross-selling-rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling-rules/available-fields": {
    "get": {
      "tags": [
        "cross-selling-rules"
      ],
      "summary": "GET /api/cross-selling-rules/available-fields",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling-rules/execute-bulk": {
    "post": {
      "tags": [
        "cross-selling-rules"
      ],
      "summary": "POST /api/cross-selling-rules/execute-bulk",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/analytics-events": {
    "post": {
      "tags": [
        "cross-selling"
      ],
      "summary": "POST /api/cross-selling/analytics-events",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/learning-settings": {
    "get": {
      "tags": [
        "cross-selling"
      ],
      "summary": "GET /api/cross-selling/learning-settings",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "put": {
      "tags": [
        "cross-selling"
      ],
      "summary": "PUT /api/cross-selling/learning-settings",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/product-labels": {
    "post": {
      "tags": [
        "cross-selling"
      ],
      "summary": "POST /api/cross-selling/product-labels",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/staging": {
    "get": {
      "tags": [
        "cross-selling"
      ],
      "summary": "GET /api/cross-selling/staging",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/staging/apply": {
    "post": {
      "tags": [
        "cross-selling"
      ],
      "summary": "POST /api/cross-selling/staging/apply",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/staging/apply-preview": {
    "get": {
      "tags": [
        "cross-selling"
      ],
      "summary": "GET /api/cross-selling/staging/apply-preview",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/staging/execute-rule": {
    "post": {
      "tags": [
        "cross-selling"
      ],
      "summary": "POST /api/cross-selling/staging/execute-rule",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/staging/regenerate": {
    "post": {
      "tags": [
        "cross-selling"
      ],
      "summary": "POST /api/cross-selling/staging/regenerate",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/staging/rules/{id}": {
    "put": {
      "tags": [
        "cross-selling"
      ],
      "summary": "PUT /api/cross-selling/staging/rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/staging/suggestions/{id}": {
    "put": {
      "tags": [
        "cross-selling"
      ],
      "summary": "PUT /api/cross-selling/staging/suggestions/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/cross-selling/staging/targeted": {
    "post": {
      "tags": [
        "cross-selling"
      ],
      "summary": "POST /api/cross-selling/staging/targeted",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dashboard/crm-interactions": {
    "get": {
      "tags": [
        "dashboard"
      ],
      "summary": "GET /api/dashboard/crm-interactions",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dashboard/delayed-orders-summary": {
    "get": {
      "tags": [
        "dashboard"
      ],
      "summary": "GET /api/dashboard/delayed-orders-summary",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dashboard/imported-inquiries": {
    "get": {
      "tags": [
        "dashboard"
      ],
      "summary": "GET /api/dashboard/imported-inquiries",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dashboard/kpis": {
    "get": {
      "tags": [
        "dashboard"
      ],
      "summary": "GET /api/dashboard/kpis",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dashboard/my-ticket-comments": {
    "get": {
      "tags": [
        "dashboard"
      ],
      "summary": "GET /api/dashboard/my-ticket-comments",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dashboard/my-tickets": {
    "get": {
      "tags": [
        "dashboard"
      ],
      "summary": "GET /api/dashboard/my-tickets",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dashboard/recent-orders": {
    "get": {
      "tags": [
        "dashboard"
      ],
      "summary": "GET /api/dashboard/recent-orders",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dashboard/shipping-ready": {
    "get": {
      "tags": [
        "dashboard"
      ],
      "summary": "GET /api/dashboard/shipping-ready",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/debug/product/{productNumber}": {
    "get": {
      "tags": [
        "debug"
      ],
      "summary": "GET /api/debug/product/{productNumber}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dunning/order/{orderId}/pdf": {
    "get": {
      "tags": [
        "dunning"
      ],
      "summary": "GET /api/dunning/order/{orderId}/pdf",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dunning/preview": {
    "get": {
      "tags": [
        "dunning"
      ],
      "summary": "GET /api/dunning/preview",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/dunning/send": {
    "post": {
      "tags": [
        "dunning"
      ],
      "summary": "POST /api/dunning/send",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/email/outbound-status": {
    "get": {
      "tags": [
        "email"
      ],
      "summary": "GET /api/email/outbound-status",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/erp-automation/history": {
    "get": {
      "tags": [
        "erp-automation"
      ],
      "summary": "GET /api/erp-automation/history",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/erp-automation/history/{orderId}": {
    "get": {
      "tags": [
        "erp-automation"
      ],
      "summary": "GET /api/erp-automation/history/{orderId}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/erp-automation/trigger": {
    "post": {
      "tags": [
        "erp-automation"
      ],
      "summary": "POST /api/erp-automation/trigger",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/installment-plans/{planId}": {
    "delete": {
      "tags": [
        "installment-plans"
      ],
      "summary": "DELETE /api/installment-plans/{planId}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "get": {
      "tags": [
        "installment-plans"
      ],
      "summary": "GET /api/installment-plans/{planId}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "installment-plans"
      ],
      "summary": "PATCH /api/installment-plans/{planId}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/installment-plans/{planId}/agreement-pdf": {
    "get": {
      "tags": [
        "installment-plans"
      ],
      "summary": "GET /api/installment-plans/{planId}/agreement-pdf",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/installment-plans/{planId}/confirm": {
    "post": {
      "tags": [
        "installment-plans"
      ],
      "summary": "POST /api/installment-plans/{planId}/confirm",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/installment-plans/{planId}/invoices-zip": {
    "get": {
      "tags": [
        "installment-plans"
      ],
      "summary": "GET /api/installment-plans/{planId}/invoices-zip",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/installment-plans/{planId}/invoices/{invoiceId}/mark-paid": {
    "post": {
      "tags": [
        "installment-plans"
      ],
      "summary": "POST /api/installment-plans/{planId}/invoices/{invoiceId}/mark-paid",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/installment-plans/{planId}/invoices/{invoiceId}/pdf": {
    "get": {
      "tags": [
        "installment-plans"
      ],
      "summary": "GET /api/installment-plans/{planId}/invoices/{invoiceId}/pdf",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/installment-plans/{planId}/send-agreement": {
    "post": {
      "tags": [
        "installment-plans"
      ],
      "summary": "POST /api/installment-plans/{planId}/send-agreement",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/m365/connections": {
    "get": {
      "tags": [
        "m365"
      ],
      "summary": "GET /api/m365/connections",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/m365/connections/{id}": {
    "delete": {
      "tags": [
        "m365"
      ],
      "summary": "DELETE /api/m365/connections/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/notifications": {
    "get": {
      "tags": [
        "notifications"
      ],
      "summary": "GET /api/notifications",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/notifications/{id}/read": {
    "patch": {
      "tags": [
        "notifications"
      ],
      "summary": "PATCH /api/notifications/{id}/read",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/notifications/mark-all-read": {
    "post": {
      "tags": [
        "notifications"
      ],
      "summary": "POST /api/notifications/mark-all-read",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/notifications/push-settings": {
    "delete": {
      "tags": [
        "notifications"
      ],
      "summary": "DELETE /api/notifications/push-settings",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "get": {
      "tags": [
        "notifications"
      ],
      "summary": "GET /api/notifications/push-settings",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "notifications"
      ],
      "summary": "POST /api/notifications/push-settings",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/notifications/stream": {
    "get": {
      "tags": [
        "notifications"
      ],
      "summary": "GET /api/notifications/stream",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/notifications/unread-count": {
    "get": {
      "tags": [
        "notifications"
      ],
      "summary": "GET /api/notifications/unread-count",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts": {
    "get": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "GET /api/offer-drafts",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts/{id}": {
    "delete": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "DELETE /api/offer-drafts/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "get": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "GET /api/offer-drafts/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "PATCH /api/offer-drafts/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts/{id}/add-bundle": {
    "post": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "POST /api/offer-drafts/{id}/add-bundle",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts/{id}/add-product": {
    "post": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "POST /api/offer-drafts/{id}/add-product",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts/{id}/clarification-email": {
    "get": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "GET /api/offer-drafts/{id}/clarification-email",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts/{id}/create-offer": {
    "post": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "POST /api/offer-drafts/{id}/create-offer",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts/{id}/create-shopware-customer": {
    "post": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "POST /api/offer-drafts/{id}/create-shopware-customer",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts/{id}/pdf": {
    "get": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "GET /api/offer-drafts/{id}/pdf",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts/customer-search": {
    "get": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "GET /api/offer-drafts/customer-search",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts/from-cpq": {
    "post": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "POST /api/offer-drafts/from-cpq",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offer-drafts/upload": {
    "post": {
      "tags": [
        "offer-drafts"
      ],
      "summary": "POST /api/offer-drafts/upload",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offers": {
    "get": {
      "tags": [
        "offers"
      ],
      "summary": "GET /api/offers",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offers/{id}": {
    "get": {
      "tags": [
        "offers"
      ],
      "summary": "GET /api/offers/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "offers"
      ],
      "summary": "PATCH /api/offers/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offers/{id}/approve": {
    "post": {
      "tags": [
        "offers"
      ],
      "summary": "POST /api/offers/{id}/approve",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offers/{id}/config-pdf": {
    "get": {
      "tags": [
        "offers"
      ],
      "summary": "GET /api/offers/{id}/config-pdf",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offers/{id}/export.csv": {
    "get": {
      "tags": [
        "offers"
      ],
      "summary": "GET /api/offers/{id}/export.csv",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offers/{id}/export.xml": {
    "get": {
      "tags": [
        "offers"
      ],
      "summary": "GET /api/offers/{id}/export.xml",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offers/{id}/pdf": {
    "get": {
      "tags": [
        "offers"
      ],
      "summary": "GET /api/offers/{id}/pdf",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offers/{id}/reject": {
    "post": {
      "tags": [
        "offers"
      ],
      "summary": "POST /api/offers/{id}/reject",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offers/{id}/share-link": {
    "delete": {
      "tags": [
        "offers"
      ],
      "summary": "DELETE /api/offers/{id}/share-link",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "get": {
      "tags": [
        "offers"
      ],
      "summary": "GET /api/offers/{id}/share-link",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "offers"
      ],
      "summary": "POST /api/offers/{id}/share-link",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/offers/learning-settings": {
    "get": {
      "tags": [
        "offers"
      ],
      "summary": "GET /api/offers/learning-settings",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "put": {
      "tags": [
        "offers"
      ],
      "summary": "PUT /api/offers/learning-settings",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/order-drafts": {
    "get": {
      "tags": [
        "order-drafts"
      ],
      "summary": "GET /api/order-drafts",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/order-drafts/{id}": {
    "delete": {
      "tags": [
        "order-drafts"
      ],
      "summary": "DELETE /api/order-drafts/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "get": {
      "tags": [
        "order-drafts"
      ],
      "summary": "GET /api/order-drafts/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "order-drafts"
      ],
      "summary": "PATCH /api/order-drafts/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/order-drafts/{id}/add-bundle": {
    "post": {
      "tags": [
        "order-drafts"
      ],
      "summary": "POST /api/order-drafts/{id}/add-bundle",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/order-drafts/{id}/add-product": {
    "post": {
      "tags": [
        "order-drafts"
      ],
      "summary": "POST /api/order-drafts/{id}/add-product",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/order-drafts/{id}/clarification-email": {
    "get": {
      "tags": [
        "order-drafts"
      ],
      "summary": "GET /api/order-drafts/{id}/clarification-email",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/order-drafts/{id}/create-order": {
    "post": {
      "tags": [
        "order-drafts"
      ],
      "summary": "POST /api/order-drafts/{id}/create-order",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/order-drafts/{id}/create-shopware-customer": {
    "post": {
      "tags": [
        "order-drafts"
      ],
      "summary": "POST /api/order-drafts/{id}/create-shopware-customer",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/order-drafts/upload": {
    "post": {
      "tags": [
        "order-drafts"
      ],
      "summary": "POST /api/order-drafts/upload",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/{orderId}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/additional-invoice": {
    "post": {
      "tags": [
        "orders"
      ],
      "summary": "POST /api/orders/{orderId}/additional-invoice",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/customer-history": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/{orderId}/customer-history",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/document/{documentId}/{deepLinkCode}": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/{orderId}/document/{documentId}/{deepLinkCode}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/documents": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/{orderId}/documents",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "orders"
      ],
      "summary": "PATCH /api/orders/{orderId}/documents",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/installment-plans": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/{orderId}/installment-plans",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "orders"
      ],
      "summary": "POST /api/orders/{orderId}/installment-plans",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/invoice": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/{orderId}/invoice",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/mark-shipped": {
    "post": {
      "tags": [
        "orders"
      ],
      "summary": "POST /api/orders/{orderId}/mark-shipped",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/proforma": {
    "post": {
      "tags": [
        "orders"
      ],
      "summary": "POST /api/orders/{orderId}/proforma",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/send-invoice": {
    "post": {
      "tags": [
        "orders"
      ],
      "summary": "POST /api/orders/{orderId}/send-invoice",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/settlement-invoice/pdf": {
    "post": {
      "tags": [
        "orders"
      ],
      "summary": "POST /api/orders/{orderId}/settlement-invoice/pdf",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/shipping": {
    "patch": {
      "tags": [
        "orders"
      ],
      "summary": "PATCH /api/orders/{orderId}/shipping",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/submit-to-mondu": {
    "post": {
      "tags": [
        "orders"
      ],
      "summary": "POST /api/orders/{orderId}/submit-to-mondu",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/{orderId}/tickets": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/{orderId}/tickets",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/bulk-tracking": {
    "post": {
      "tags": [
        "orders"
      ],
      "summary": "POST /api/orders/bulk-tracking",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/comment-counts": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/comment-counts",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/delayed": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/delayed",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/export": {
    "post": {
      "tags": [
        "orders"
      ],
      "summary": "POST /api/orders/export",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/invoices/by-order-numbers": {
    "post": {
      "tags": [
        "orders"
      ],
      "summary": "POST /api/orders/invoices/by-order-numbers",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/query": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/query",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/orders/ticket-counts": {
    "get": {
      "tags": [
        "orders"
      ],
      "summary": "GET /api/orders/ticket-counts",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/parse-email": {
    "post": {
      "tags": [
        "parse-email"
      ],
      "summary": "POST /api/parse-email",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/portal/tickets": {
    "get": {
      "tags": [
        "portal"
      ],
      "summary": "GET /api/portal/tickets",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "portal"
      ],
      "summary": "POST /api/portal/tickets",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/portal/tickets/{id}": {
    "get": {
      "tags": [
        "portal"
      ],
      "summary": "GET /api/portal/tickets/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/portal/tickets/{id}/comments": {
    "get": {
      "tags": [
        "portal"
      ],
      "summary": "GET /api/portal/tickets/{id}/comments",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "portal"
      ],
      "summary": "POST /api/portal/tickets/{id}/comments",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/process-updates": {
    "get": {
      "tags": [
        "process-updates"
      ],
      "summary": "GET /api/process-updates",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "process-updates"
      ],
      "summary": "POST /api/process-updates",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/process-updates/{id}": {
    "delete": {
      "tags": [
        "process-updates"
      ],
      "summary": "DELETE /api/process-updates/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "put": {
      "tags": [
        "process-updates"
      ],
      "summary": "PUT /api/process-updates/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products": {
    "get": {
      "tags": [
        "products"
      ],
      "summary": "GET /api/products",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/{productId}/active": {
    "patch": {
      "tags": [
        "products"
      ],
      "summary": "PATCH /api/products/{productId}/active",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/{productId}/categories": {
    "get": {
      "tags": [
        "products"
      ],
      "summary": "GET /api/products/{productId}/categories",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "products"
      ],
      "summary": "PATCH /api/products/{productId}/categories",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/{productId}/cross-selling": {
    "get": {
      "tags": [
        "products"
      ],
      "summary": "GET /api/products/{productId}/cross-selling",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "products"
      ],
      "summary": "POST /api/products/{productId}/cross-selling",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/{productId}/cross-selling-suggestions": {
    "get": {
      "tags": [
        "products"
      ],
      "summary": "GET /api/products/{productId}/cross-selling-suggestions",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/{productId}/cross-selling/{crossSellingId}": {
    "delete": {
      "tags": [
        "products"
      ],
      "summary": "DELETE /api/products/{productId}/cross-selling/{crossSellingId}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "put": {
      "tags": [
        "products"
      ],
      "summary": "PUT /api/products/{productId}/cross-selling/{crossSellingId}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/{productId}/data-quality": {
    "get": {
      "tags": [
        "products"
      ],
      "summary": "GET /api/products/{productId}/data-quality",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/{productId}/glb": {
    "patch": {
      "tags": [
        "products"
      ],
      "summary": "PATCH /api/products/{productId}/glb",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/{productId}/sales-channels": {
    "get": {
      "tags": [
        "products"
      ],
      "summary": "GET /api/products/{productId}/sales-channels",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "products"
      ],
      "summary": "PATCH /api/products/{productId}/sales-channels",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/cache-status": {
    "get": {
      "tags": [
        "products"
      ],
      "summary": "GET /api/products/cache-status",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/obx-search": {
    "post": {
      "tags": [
        "products"
      ],
      "summary": "POST /api/products/obx-search",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/overview": {
    "get": {
      "tags": [
        "products"
      ],
      "summary": "GET /api/products/overview",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/refresh-cache": {
    "post": {
      "tags": [
        "products"
      ],
      "summary": "POST /api/products/refresh-cache",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/products/semantic-search": {
    "post": {
      "tags": [
        "products"
      ],
      "summary": "POST /api/products/semantic-search",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/profile": {
    "put": {
      "tags": [
        "profile"
      ],
      "summary": "PUT /api/profile",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/profile/password": {
    "put": {
      "tags": [
        "profile"
      ],
      "summary": "PUT /api/profile/password",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/public/offers/{token}": {
    "get": {
      "tags": [
        "public"
      ],
      "summary": "GET /api/public/offers/{token}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      },
      "security": []
    }
  },
  "/api/public/offers/{token}/accept": {
    "post": {
      "tags": [
        "public"
      ],
      "summary": "POST /api/public/offers/{token}/accept",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      },
      "security": []
    }
  },
  "/api/public/offers/{token}/config-pdf": {
    "get": {
      "tags": [
        "public"
      ],
      "summary": "GET /api/public/offers/{token}/config-pdf",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      },
      "security": []
    }
  },
  "/api/public/offers/{token}/decline": {
    "post": {
      "tags": [
        "public"
      ],
      "summary": "POST /api/public/offers/{token}/decline",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      },
      "security": []
    }
  },
  "/api/public/offers/{token}/glb-resolve": {
    "get": {
      "tags": [
        "public"
      ],
      "summary": "GET /api/public/offers/{token}/glb-resolve",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      },
      "security": []
    }
  },
  "/api/public/offers/{token}/pdf": {
    "get": {
      "tags": [
        "public"
      ],
      "summary": "GET /api/public/offers/{token}/pdf",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      },
      "security": []
    }
  },
  "/api/roles": {
    "get": {
      "tags": [
        "roles"
      ],
      "summary": "GET /api/roles",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "roles"
      ],
      "summary": "POST /api/roles",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/roles/{id}": {
    "delete": {
      "tags": [
        "roles"
      ],
      "summary": "DELETE /api/roles/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "roles"
      ],
      "summary": "PATCH /api/roles/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/sales-channels": {
    "get": {
      "tags": [
        "sales-channels"
      ],
      "summary": "GET /api/sales-channels",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/search/global": {
    "get": {
      "tags": [
        "search"
      ],
      "summary": "GET /api/search/global",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/semantic/faq": {
    "post": {
      "tags": [
        "semantic"
      ],
      "summary": "POST /api/semantic/faq",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/semantic/faq/feedback": {
    "post": {
      "tags": [
        "semantic"
      ],
      "summary": "POST /api/semantic/faq/feedback",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/semantic/index": {
    "post": {
      "tags": [
        "semantic"
      ],
      "summary": "POST /api/semantic/index",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/semantic/search": {
    "post": {
      "tags": [
        "semantic"
      ],
      "summary": "POST /api/semantic/search",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/semantic/search/feedback": {
    "post": {
      "tags": [
        "semantic"
      ],
      "summary": "POST /api/semantic/search/feedback",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/semantic/similar": {
    "post": {
      "tags": [
        "semantic"
      ],
      "summary": "POST /api/semantic/similar",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/ai": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/ai",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/ai",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/ai-prompts": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/ai-prompts",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/ai-prompts",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/b2b-offer-status-mapping": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/b2b-offer-status-mapping",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/b2b-offer-status-mapping",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/commercial-agent": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/commercial-agent",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/commercial-agent",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/dunning": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/dunning",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/dunning",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/email-inbound": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/email-inbound",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/email-inbound",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/email-outbound": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/email-outbound",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/email-outbound",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/email-routing": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/email-routing",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/email-routing",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/google-ads": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/google-ads",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/google-ads",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/google-analytics": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/google-analytics",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/google-analytics",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/integration-api-keys": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/integration-api-keys",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/integration-api-keys",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/integration-api-keys/{id}": {
    "delete": {
      "tags": [
        "settings"
      ],
      "summary": "DELETE /api/settings/integration-api-keys/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/m365": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/m365",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/m365",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/mondu": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/mondu",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/mondu",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/mondu/test": {
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/mondu/test",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/offer-config-pdf-texts": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/offer-config-pdf-texts",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/offer-config-pdf-texts",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/proforma-number-range": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/proforma-number-range",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/proforma-number-range",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/semantic-ranking": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/semantic-ranking",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/semantic-ranking",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/shopware": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/shopware",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/shopware",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/shopware/test": {
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/shopware/test",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/ticket-sla": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/ticket-sla",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "settings"
      ],
      "summary": "POST /api/settings/ticket-sla",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/webhooks": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/webhooks",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/settings/webhooks/{eventType}": {
    "get": {
      "tags": [
        "settings"
      ],
      "summary": "GET /api/settings/webhooks/{eventType}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "settings"
      ],
      "summary": "PATCH /api/settings/webhooks/{eventType}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/shipping": {
    "get": {
      "tags": [
        "shipping"
      ],
      "summary": "GET /api/shipping",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/templates": {
    "get": {
      "tags": [
        "templates"
      ],
      "summary": "GET /api/templates",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "templates"
      ],
      "summary": "POST /api/templates",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/templates/{id}": {
    "delete": {
      "tags": [
        "templates"
      ],
      "summary": "DELETE /api/templates/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "get": {
      "tags": [
        "templates"
      ],
      "summary": "GET /api/templates/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "templates"
      ],
      "summary": "PATCH /api/templates/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/templates/favorites": {
    "get": {
      "tags": [
        "templates"
      ],
      "summary": "GET /api/templates/favorites",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "templates"
      ],
      "summary": "POST /api/templates/favorites",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tenants": {
    "get": {
      "tags": [
        "tenants"
      ],
      "summary": "GET /api/tenants",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tenants/select": {
    "post": {
      "tags": [
        "tenants"
      ],
      "summary": "POST /api/tenants/select",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ticket-assignment-rules": {
    "get": {
      "tags": [
        "ticket-assignment-rules"
      ],
      "summary": "GET /api/ticket-assignment-rules",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "ticket-assignment-rules"
      ],
      "summary": "POST /api/ticket-assignment-rules",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/ticket-assignment-rules/{id}": {
    "delete": {
      "tags": [
        "ticket-assignment-rules"
      ],
      "summary": "DELETE /api/ticket-assignment-rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "get": {
      "tags": [
        "ticket-assignment-rules"
      ],
      "summary": "GET /api/ticket-assignment-rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "ticket-assignment-rules"
      ],
      "summary": "PATCH /api/ticket-assignment-rules/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets": {
    "get": {
      "tags": [
        "tickets"
      ],
      "summary": "GET /api/tickets",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "tickets"
      ],
      "summary": "POST /api/tickets",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/{id}": {
    "delete": {
      "tags": [
        "tickets"
      ],
      "summary": "DELETE /api/tickets/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "get": {
      "tags": [
        "tickets"
      ],
      "summary": "GET /api/tickets/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "tickets"
      ],
      "summary": "PATCH /api/tickets/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/{ticketId}/activity": {
    "get": {
      "tags": [
        "tickets"
      ],
      "summary": "GET /api/tickets/{ticketId}/activity",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/{ticketId}/attachments": {
    "get": {
      "tags": [
        "tickets"
      ],
      "summary": "GET /api/tickets/{ticketId}/attachments",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "tickets"
      ],
      "summary": "POST /api/tickets/{ticketId}/attachments",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/{ticketId}/attachments/mark-read": {
    "post": {
      "tags": [
        "tickets"
      ],
      "summary": "POST /api/tickets/{ticketId}/attachments/mark-read",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/{ticketId}/comments": {
    "get": {
      "tags": [
        "tickets"
      ],
      "summary": "GET /api/tickets/{ticketId}/comments",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "tickets"
      ],
      "summary": "POST /api/tickets/{ticketId}/comments",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/{ticketId}/comments/{commentId}": {
    "delete": {
      "tags": [
        "tickets"
      ],
      "summary": "DELETE /api/tickets/{ticketId}/comments/{commentId}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/{ticketId}/comments/mark-read": {
    "post": {
      "tags": [
        "tickets"
      ],
      "summary": "POST /api/tickets/{ticketId}/comments/mark-read",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/{ticketId}/unread-counts": {
    "get": {
      "tags": [
        "tickets"
      ],
      "summary": "GET /api/tickets/{ticketId}/unread-counts",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/assignees": {
    "get": {
      "tags": [
        "tickets"
      ],
      "summary": "GET /api/tickets/assignees",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/export": {
    "post": {
      "tags": [
        "tickets"
      ],
      "summary": "POST /api/tickets/export",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/tickets/from-email": {
    "post": {
      "tags": [
        "tickets"
      ],
      "summary": "POST /api/tickets/from-email",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/users": {
    "get": {
      "tags": [
        "users"
      ],
      "summary": "GET /api/users",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "post": {
      "tags": [
        "users"
      ],
      "summary": "POST /api/users",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/users/{id}": {
    "delete": {
      "tags": [
        "users"
      ],
      "summary": "DELETE /api/users/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    },
    "patch": {
      "tags": [
        "users"
      ],
      "summary": "PATCH /api/users/{id}",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/users/assignable": {
    "get": {
      "tags": [
        "users"
      ],
      "summary": "GET /api/users/assignable",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/webhooks/incoming/tickets": {
    "post": {
      "tags": [
        "webhooks"
      ],
      "summary": "POST /api/webhooks/incoming/tickets",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/webhooks/logs": {
    "get": {
      "tags": [
        "webhooks"
      ],
      "summary": "GET /api/webhooks/logs",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  },
  "/api/webhooks/test": {
    "post": {
      "tags": [
        "webhooks"
      ],
      "summary": "POST /api/webhooks/test",
      "responses": {
        "200": {
          "description": "OK",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "additionalProperties": true
              }
            }
          }
        },
        "401": {
          "description": "Nicht angemeldet oder ungültige Session"
        },
        "403": {
          "description": "Fehlende Berechtigung oder CSRF/Origin abgelehnt"
        }
      }
    }
  }
} as const;
