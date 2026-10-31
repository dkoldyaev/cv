const path = require('path');
const fs = require('fs');

const schemaPath = path.join(__dirname, 'schema.json');
const cvSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

// Convert JSON Schema draft 2020-12 definitions to OpenAPI 3.0.3 components/schemas compatible format
function generateOpenApiSpec(baseUrl = 'https://cv.build.dkoldyaev.com') {
  // Deep clone schema and fix $defs -> components/schemas if needed
  const schemaClean = JSON.parse(
    JSON.stringify(cvSchema)
      .replace(/#\/\$defs\//g, '#/components/schemas/')
  );

  const defs = schemaClean.$defs || {};
  delete schemaClean.$defs;
  delete schemaClean.$schema;

  return {
    openapi: '3.0.3',
    info: {
      title: 'Curriculum Vitae Dynamic API',
      description: 'Public API for publishing, rendering, and retrieving curriculum vitae documents in HTML, Markdown, JSON, and PDF formats with Schema.org JSON-LD support.',
      version: '1.0.0',
      contact: {
        name: 'Dmitry Koldyaev',
        email: 'dkoldyaev@gmail.com',
        url: 'https://cv.build.dkoldyaev.com'
      }
    },
    servers: [
      {
        url: baseUrl,
        description: 'Current environment server'
      }
    ],
    paths: {
      '/api/cv': {
        post: {
          summary: 'Publish a new CV version',
          description: 'Validates provided CV JSON according to Developer CV JSON Schema, generates unique UUID endpoints for HTML, Markdown, JSON, and lazy PDF, and stores files.',
          security: [
            { BearerAuth: [] },
            { ApiKeyAuth: [] }
          ],
          requestBody: {
            required: true,
            description: 'Structured CV payload adhering strictly to the schema',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/DeveloperCV'
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'CV generated and published successfully',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/CvPublishResponse'
                  },
                  example: {
                    id: '33592570-2b3b-4394-9192-c2676d3aecf2',
                    title: 'Dmitry Koldyaev - Frontend Developer',
                    url: `${baseUrl}/33592570-2b3b-4394-9192-c2676d3aecf2`,
                    markdownUrl: `${baseUrl}/33592570-2b3b-4394-9192-c2676d3aecf2.md`,
                    pdfUrl: `${baseUrl}/33592570-2b3b-4394-9192-c2676d3aecf2.pdf`,
                    jsonUrl: `${baseUrl}/33592570-2b3b-4394-9192-c2676d3aecf2.json`,
                    createdAt: '2026-10-31T17:22:32.798Z'
                  }
                }
              }
            },
            '400': {
              description: 'JSON Schema Validation Failure',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: { type: 'string' },
                      details: { type: 'array', items: { type: 'object' } }
                    }
                  }
                }
              }
            },
            '401': {
              description: 'Unauthorized - invalid or missing API Token',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/{id}': {
        get: {
          summary: 'Retrieve CV HTML document',
          description: 'Returns the exact formatted HTML document for the given UUID or root CV without caching.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              description: 'CV unique UUID or "root"',
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'Rendered HTML page with JSON-LD metadata',
              content: {
                'text/html': {
                  schema: { type: 'string' }
                }
              }
            },
            '404': {
              description: 'CV not found'
            }
          }
        }
      },
      '/{id}.md': {
        get: {
          summary: 'Retrieve CV in Markdown format',
          description: 'Returns clean markdown text matching CV content.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'Markdown document',
              content: {
                'text/markdown': {
                  schema: { type: 'string' }
                }
              }
            },
            '404': { description: 'CV not found' }
          }
        }
      },
      '/{id}.json': {
        get: {
          summary: 'Retrieve original CV JSON',
          description: 'Returns the exact JSON submitted when creating this CV version.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'CV structured JSON',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DeveloperCV' }
                }
              }
            },
            '404': { description: 'CV not found' }
          }
        }
      },
      '/{id}.pdf': {
        get: {
          summary: 'Retrieve CV in PDF format (Lazy generation)',
          description: 'On-demand lazy generation via headless Chromium print-to-PDF, cached on disk.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'Generated PDF binary document',
              content: {
                'application/pdf': {
                  schema: { type: 'string', format: 'binary' }
                }
              }
            },
            '404': { description: 'CV not found' }
          }
        }
      },
      '/schema.json': {
        get: {
          summary: 'Developer CV JSON Schema',
          description: 'Returns the Draft 2020-12 schema used for CV validation.',
          responses: {
            '200': {
              description: 'JSON Schema document',
              content: {
                'application/json': {
                  schema: { type: 'object' }
                }
              }
            }
          }
        }
      },
      '/openapi.json': {
        get: {
          summary: 'OpenAPI Specification (JSON)',
          description: 'Returns this OpenAPI 3.0.3 specification in JSON format.',
          responses: {
            '200': {
              description: 'OpenAPI specification document',
              content: {
                'application/json': { schema: { type: 'object' } }
              }
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API Token generated in the Admin Dashboard (format: cvt_...)'
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Alternative header for API Token'
        }
      },
      schemas: {
        DeveloperCV: schemaClean,
        ...defs,
        CvPublishResponse: {
          type: 'object',
          required: ['id', 'title', 'url', 'markdownUrl', 'pdfUrl', 'jsonUrl', 'createdAt'],
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Generated unique CV identifier' },
            title: { type: 'string', description: 'CV document title extracted from person name & headline' },
            url: { type: 'string', format: 'uri', description: 'Permanent HTML document link' },
            markdownUrl: { type: 'string', format: 'uri', description: 'Direct link to Markdown format' },
            pdfUrl: { type: 'string', format: 'uri', description: 'Direct link to PDF format' },
            jsonUrl: { type: 'string', format: 'uri', description: 'Direct link to original JSON payload' },
            createdAt: { type: 'string', format: 'date-time', description: 'Creation ISO 8601 timestamp' }
          }
        }
      }
    }
  };
}

function renderSwaggerUiHtml(specUrl = '/openapi.json') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Curriculum Vitae API Documentation</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; background: #fafafa; }
    .topbar { display: none !important; }
    .custom-header {
      background: #1a202c;
      color: white;
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .custom-header a {
      color: #90cdf4;
      text-decoration: none;
      font-size: 14px;
      margin-left: 16px;
    }
    .custom-header a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="custom-header">
    <div style="font-weight: 600; font-size: 16px;">
      ⚡ CV Dynamic API Reference (OpenAPI 3.0)
    </div>
    <div>
      <a href="/openapi.json" target="_blank">Raw openapi.json ↗</a>
      <a href="/admin">← Back to Admin</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '${specUrl}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
}

module.exports = {
  generateOpenApiSpec,
  renderSwaggerUiHtml
};
