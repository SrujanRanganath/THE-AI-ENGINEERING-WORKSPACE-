import {
  CleaningOperation,
  CleaningStrategy,
  DatasetAiProfile,
  FilterOperator,
} from './dataCleaner';
import {
  getSampleReactWebsiteManifest,
  ManifestFile as WebsiteManifestFile,
} from './reactPreviewCompiler';
import { sanitizeArchivePath } from './zipExport';
import { ModifiedFile } from '../components/common/DiffViewer';

export type AgentExecutionMode = 'live' | 'demo';

export interface DemoCodeProjectPayload {
  projectName: string;
  language: string;
  framework: string;
  database: string;
  architectureOverview: string;
  runInstructions: string;
  files: Array<{
    path: string;
    content: string;
    language: string;
  }>;
}

export interface DemoWebsiteProjectPayload {
  websiteName: string;
  category: string;
  technology: string;
  designDirection: string;
  summary: string;
  fileManifest: WebsiteManifestFile[];
}

export interface DemoDocumentPayload {
  title: string;
  subtitle: string;
  category: string;
  tone: string;
  length: string;
  sections: Array<{
    heading: string;
    level: 1 | 2 | 3;
    paragraphs: string[];
    bullets: string[];
  }>;
  fullMarkdown: string;
}

export interface DemoCleaningPlanResult {
  status: 'ready' | 'needs_clarification' | 'invalid_column';
  explanation: string;
  clarificationQuestion?: string;
  pendingColumnRemovalCount?: number;
  operations: CleaningOperation[];
  executionMode: 'demo';
}

// ============================================================================
// AGENT 1: CODE GENERATOR DEMO ENGINE
// ============================================================================

export function generateDemoCodeProject(options: {
  projectName?: string;
  language?: string;
  framework?: string;
  database?: string;
  description?: string;
}): DemoCodeProjectPayload {
  const projectName = (options.projectName || 'OrderLedgerService').trim() || 'OrderLedgerService';
  const language = (options.language || 'TypeScript').trim();
  const framework = (options.framework || 'Standard').trim();
  const database = (options.database || 'PostgreSQL').trim();
  const safePkg =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'demo-service';
  const safeIdent =
    projectName.replace(/[^a-zA-Z0-9]/g, '') || 'WorkspaceApp';
  const summaryDesc = (
    options.description ||
    'Modular backend microservice with request validation, health probes, and unit tests.'
  ).trim();

  const lowerLang = language.toLowerCase();

  if (lowerLang === 'python') {
    const isFlask = framework.toLowerCase().includes('flask');
    const files = [
      {
        path: 'requirements.txt',
        language: 'text',
        content: isFlask
          ? 'flask>=3.0.0\npydantic>=2.9.0\npytest>=8.3.0\n'
          : 'fastapi>=0.115.0\nuvicorn>=0.32.0\npydantic>=2.9.0\npytest>=8.3.0\n',
      },
      {
        path: 'app/main.py',
        language: 'python',
        content: isFlask
          ? `from flask import Flask, jsonify, request
from app.validators import validate_order_payload

app = Flask(__name__)

@app.get("/health")
def health_check():
    return jsonify({"service": "${projectName}", "status": "healthy", "database": "${database}"})

@app.post("/api/v1/items")
def create_item():
    payload = request.get_json(silent=True) or {}
    ok, error = validate_order_payload(payload)
    if not ok:
        return jsonify({"error": error}), 400
    return jsonify({"status": "created", "item": payload}), 201

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
`
          : `from fastapi import FastAPI, HTTPException
from app.validators import ItemPayload, validate_order_payload

app = FastAPI(title="${projectName}")

@app.get("/health")
def health_check():
    return {"service": "${projectName}", "status": "healthy", "database": "${database}"}

@app.post("/api/v1/items", status_code=201)
def create_item(payload: ItemPayload):
    ok, error = validate_order_payload(payload.model_dump())
    if not ok:
        raise HTTPException(status_code=400, detail=error)
    return {"status": "created", "item": payload.model_dump()}
`,
      },
      {
        path: 'app/validators.py',
        language: 'python',
        content: `from pydantic import BaseModel, Field

class ItemPayload(BaseModel):
    sku: str = Field(min_length=2, max_length=64)
    quantity: int = Field(gt=0)

def validate_order_payload(payload: dict) -> tuple[bool, str | None]:
    sku = str(payload.get("sku", "")).strip()
    qty = payload.get("quantity")
    if not sku:
        return False, "Missing required field: sku"
    if not isinstance(qty, int) or qty <= 0:
        return False, "Quantity must be a positive integer"
    return True, None
`,
      },
      {
        path: 'tests/test_app.py',
        language: 'python',
        content: `from app.validators import validate_order_payload

def test_valid_payload():
    ok, err = validate_order_payload({"sku": "SKU-100", "quantity": 2})
    assert ok is True
    assert err is None

def test_invalid_quantity():
    ok, err = validate_order_payload({"sku": "SKU-100", "quantity": 0})
    assert ok is False
    assert "Quantity" in (err or "")
`,
      },
      {
        path: 'README.md',
        language: 'markdown',
        content: `# ${projectName} (Demo Mode Template)

> Generated locally in **Demo Mode** without live Gemini API calls.

- **Language:** Python (${framework})
- **Database:** ${database}
- **Goal:** ${summaryDesc}

\`\`\`bash
pip install -r requirements.txt
pytest
\`\`\`
`,
      },
    ];

    return {
      projectName,
      language,
      framework,
      database,
      architectureOverview: `[Demo Mode] Layered Python (${framework}) service architecture with schema validation, health endpoints, and pytest suite targeting ${database}.`,
      runInstructions: isFlask
        ? 'pip install -r requirements.txt && python -m app.main'
        : 'pip install -r requirements.txt && uvicorn app.main:app --reload',
      files: files.map((f) => ({ ...f, path: sanitizeArchivePath(f.path) })),
    };
  }

  if (lowerLang === 'java') {
    const pkgPath = safePkg.replace(/-/g, '');
    const files = [
      {
        path: 'pom.xml',
        language: 'xml',
        content: `<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.workspace.${pkgPath}</groupId>
  <artifactId>${safePkg}</artifactId>
  <version>1.0.0</version>
  <properties>
    <maven.compiler.source>21</maven.compiler.source>
    <maven.compiler.target>21</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
`,
      },
      {
        path: `src/main/java/com/workspace/${pkgPath}/${safeIdent}Application.java`,
        language: 'java',
        content: `package com.workspace.${pkgPath};

import com.workspace.${pkgPath}.service.CoreService;
import com.workspace.${pkgPath}.model.TaskRecord;

public class ${safeIdent}Application {
    public static void main(String[] args) {
        CoreService service = new CoreService("${database}");
        TaskRecord created = service.createRecord("init-task", "${summaryDesc.replace(/"/g, '\\"')}");
        System.out.println("Service started: " + service.healthStatus());
        System.out.println("Initial record ID: " + created.getId());
    }
}
`,
      },
      {
        path: `src/main/java/com/workspace/${pkgPath}/model/TaskRecord.java`,
        language: 'java',
        content: `package com.workspace.${pkgPath}.model;

public class TaskRecord {
    private final String id;
    private final String title;
    private final String notes;

    public TaskRecord(String id, String title, String notes) {
        this.id = id;
        this.title = title;
        this.notes = notes;
    }

    public String getId() { return id; }
    public String getTitle() { return title; }
    public String getNotes() { return notes; }
}
`,
      },
      {
        path: `src/main/java/com/workspace/${pkgPath}/service/CoreService.java`,
        language: 'java',
        content: `package com.workspace.${pkgPath}.service;

import com.workspace.${pkgPath}.model.TaskRecord;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class CoreService {
    private final String databaseName;
    private final Map<String, TaskRecord> store = new ConcurrentHashMap<>();

    public CoreService(String databaseName) {
        this.databaseName = databaseName;
    }

    public TaskRecord createRecord(String title, String notes) {
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("Title must not be blank");
        }
        String id = "rec_" + UUID.randomUUID().toString().substring(0, 8);
        TaskRecord record = new TaskRecord(id, title.trim(), notes == null ? "" : notes.trim());
        store.put(id, record);
        return record;
    }

    public String healthStatus() {
        return "UP (database=" + databaseName + ", records=" + store.size() + ")";
    }
}
`,
      },
      {
        path: `src/test/java/com/workspace/${pkgPath}/CoreServiceTest.java`,
        language: 'java',
        content: `package com.workspace.${pkgPath};

import com.workspace.${pkgPath}.model.TaskRecord;
import com.workspace.${pkgPath}.service.CoreService;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CoreServiceTest {
    @Test
    void createsValidRecord() {
        CoreService service = new CoreService("${database}");
        TaskRecord record = service.createRecord("Sample", "Verification run");
        assertNotNull(record.getId());
        assertEquals("Sample", record.getTitle());
    }
}
`,
      },
      {
        path: 'README.md',
        language: 'markdown',
        content: `# ${projectName} (Java · Demo Mode)\n\n- **Framework:** ${framework}\n- **Database:** ${database}\n- **Goal:** ${summaryDesc}\n\n\`\`\`bash\nmvn test\nmvn compile exec:java\n\`\`\`\n`,
      },
    ];

    return {
      projectName,
      language,
      framework,
      database,
      architectureOverview: `[Demo Mode] Layered Java 21 (${framework}) Maven project with domain model, thread-safe CoreService, and JUnit 5 unit tests.`,
      runInstructions: 'mvn test && mvn compile',
      files: files.map((f) => ({ ...f, path: sanitizeArchivePath(f.path) })),
    };
  }

  if (lowerLang === 'c++' || lowerLang === 'cpp') {
    const files = [
      {
        path: 'CMakeLists.txt',
        language: 'cmake',
        content: `cmake_minimum_required(VERSION 3.16)
project(${safeIdent} LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include)
add_executable(${safePkg} src/main.cpp src/engine.cpp)
enable_testing()
add_executable(${safePkg}_tests tests/test_engine.cpp src/engine.cpp)
add_test(NAME core_tests COMMAND ${safePkg}_tests)
`,
      },
      {
        path: 'include/engine.hpp',
        language: 'cpp',
        content: `#pragma once
#include <string>
#include <vector>

namespace workspace {

struct Record {
    int id;
    std::string label;
    double value;
};

class CoreEngine {
public:
    explicit CoreEngine(std::string serviceName);
    Record addRecord(const std::string& label, double value);
    std::size_t count() const noexcept;
    const std::string& serviceName() const noexcept;

private:
    std::string name_;
    std::vector<Record> records_;
};

} // namespace workspace
`,
      },
      {
        path: 'src/engine.cpp',
        language: 'cpp',
        content: `#include "engine.hpp"
#include <stdexcept>

namespace workspace {

CoreEngine::CoreEngine(std::string serviceName) : name_(std::move(serviceName)) {}

Record CoreEngine::addRecord(const std::string& label, double value) {
    if (label.empty()) {
        throw std::invalid_argument("Record label cannot be empty");
    }
    Record rec{static_cast<int>(records_.size() + 1), label, value};
    records_.push_back(rec);
    return rec;
}

std::size_t CoreEngine::count() const noexcept {
    return records_.size();
}

const std::string& CoreEngine::serviceName() const noexcept {
    return name_;
}

} // namespace workspace
`,
      },
      {
        path: 'src/main.cpp',
        language: 'cpp',
        content: `#include "engine.hpp"
#include <iostream>

int main() {
    workspace::CoreEngine engine("${projectName}");
    auto rec = engine.addRecord("initial-metric", 99.5);
    std::cout << engine.serviceName() << " initialized record #" << rec.id << "\\n";
    return 0;
}
`,
      },
      {
        path: 'tests/test_engine.cpp',
        language: 'cpp',
        content: `#include "engine.hpp"
#include <cassert>

int main() {
    workspace::CoreEngine engine("TestService");
    auto rec = engine.addRecord("alpha", 42.0);
    assert(rec.id == 1);
    assert(engine.count() == 1);
    return 0;
}
`,
      },
      {
        path: 'README.md',
        language: 'markdown',
        content: `# ${projectName} (C++20 · Demo Mode)\n\n- **Specification:** ${summaryDesc}\n\n\`\`\`bash\ncmake -S . -B build && cmake --build build && ctest --test-dir build\n\`\`\`\n`,
      },
    ];

    return {
      projectName,
      language,
      framework,
      database,
      architectureOverview: `[Demo Mode] Modern C++20 modular project with CMake build, separated header/source units, and automated CTest verification.`,
      runInstructions: 'cmake -S . -B build && cmake --build build && ./build/' + safePkg,
      files: files.map((f) => ({ ...f, path: sanitizeArchivePath(f.path) })),
    };
  }

  if (lowerLang === 'c') {
    const files = [
      {
        path: 'Makefile',
        language: 'makefile',
        content: `CC=gcc
CFLAGS=-std=c11 -Wall -Wextra -Iinclude

all: build/${safePkg}

build/${safePkg}: src/main.c src/ledger.c
\t@mkdir -p build
\t$(CC) $(CFLAGS) src/main.c src/ledger.c -o build/${safePkg}

test: src/ledger.c tests/test_ledger.c
\t@mkdir -p build
\t$(CC) $(CFLAGS) tests/test_ledger.c src/ledger.c -o build/test_runner
\t./build/test_runner

clean:
\trm -rf build
`,
      },
      {
        path: 'include/ledger.h',
        language: 'c',
        content: `#ifndef WORKSPACE_LEDGER_H
#define WORKSPACE_LEDGER_H

#include <stddef.h>

typedef struct {
    int id;
    char label[64];
    double amount;
} LedgerEntry;

int ledger_add_entry(LedgerEntry* out_entry, int id, const char* label, double amount);

#endif
`,
      },
      {
        path: 'src/ledger.c',
        language: 'c',
        content: `#include "ledger.h"
#include <string.h>

int ledger_add_entry(LedgerEntry* out_entry, int id, const char* label, double amount) {
    if (!out_entry || !label || label[0] == '\\0') {
        return -1;
    }
    out_entry->id = id;
    out_entry->amount = amount;
    strncpy(out_entry->label, label, sizeof(out_entry->label) - 1);
    out_entry->label[sizeof(out_entry->label) - 1] = '\\0';
    return 0;
}
`,
      },
      {
        path: 'src/main.c',
        language: 'c',
        content: `#include <stdio.h>
#include "ledger.h"

int main(void) {
    LedgerEntry entry;
    if (ledger_add_entry(&entry, 1, "${projectName}", 100.0) != 0) {
        fprintf(stderr, "Failed to initialize entry\\n");
        return 1;
    }
    printf("Initialized %s (#%d, %.2f)\\n", entry.label, entry.id, entry.amount);
    return 0;
}
`,
      },
      {
        path: 'tests/test_ledger.c',
        language: 'c',
        content: `#include <assert.h>
#include "ledger.h"

int main(void) {
    LedgerEntry e;
    assert(ledger_add_entry(&e, 10, "valid", 25.5) == 0);
    assert(e.id == 10);
    assert(ledger_add_entry(&e, 11, "", 0.0) == -1);
    return 0;
}
`,
      },
      {
        path: 'README.md',
        language: 'markdown',
        content: `# ${projectName} (C11 · Demo Mode)\n\n- **Goal:** ${summaryDesc}\n\n\`\`\`bash\nmake && make test\n\`\`\`\n`,
      },
    ];

    return {
      projectName,
      language,
      framework,
      database,
      architectureOverview: `[Demo Mode] Portable C11 modular layout with strict compiler flags (-Wall -Wextra), header/source separation, and C assertion unit test harness.`,
      runInstructions: 'make && ./build/' + safePkg,
      files: files.map((f) => ({ ...f, path: sanitizeArchivePath(f.path) })),
    };
  }

  if (lowerLang === 'go' || lowerLang === 'golang') {
    const files = [
      {
        path: 'go.mod',
        language: 'go',
        content: `module github.com/workspace/${safePkg}\n\ngo 1.22\n`,
      },
      {
        path: 'cmd/server/main.go',
        language: 'go',
        content: `package main

import (
\t"log"
\t"net/http"
\t"github.com/workspace/${safePkg}/internal/handler"
)

func main() {
\tmux := http.NewServeMux()
\tmux.HandleFunc("/health", handler.HealthCheck("${projectName}", "${database}"))
\tlog.Println("Listening on :8080")
\tlog.Fatal(http.ListenAndServe(":8080", mux))
}
`,
      },
      {
        path: 'internal/handler/health.go',
        language: 'go',
        content: `package handler

import (
\t"encoding/json"
\t"net/http"
)

func HealthCheck(service string, db string) http.HandlerFunc {
\treturn func(w http.ResponseWriter, r *http.Request) {
\t\tw.Header().Set("Content-Type", "application/json")
\t\t_ = json.NewEncoder(w).Encode(map[string]string{
\t\t\t"service": service,
\t\t\t"database": db,
\t\t\t"status": "healthy",
\t\t})
\t}
}
`,
      },
      {
        path: 'README.md',
        language: 'markdown',
        content: `# ${projectName} (Go · Demo Mode)\n\n\`\`\`bash\ngo test ./...\ngo run ./cmd/server\n\`\`\`\n`,
      },
    ];
    return {
      projectName,
      language,
      framework,
      database,
      architectureOverview: `[Demo Mode] Standard Go module layout (cmd/ + internal/handler) with HTTP health probes targeting ${database}.`,
      runInstructions: 'go run ./cmd/server',
      files: files.map((f) => ({ ...f, path: sanitizeArchivePath(f.path) })),
    };
  }

  if (lowerLang === 'c#' || lowerLang === 'csharp') {
    const files = [
      {
        path: `${safeIdent}.csproj`,
        language: 'xml',
        content: `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n`,
      },
      {
        path: 'Program.cs',
        language: 'csharp',
        content: `using ${safeIdent}.Services;\n\nvar service = new CoreService("${database}");\nConsole.WriteLine(service.HealthSummary("${projectName}"));\n`,
      },
      {
        path: 'Services/CoreService.cs',
        language: 'csharp',
        content: `namespace ${safeIdent}.Services;\n\npublic class CoreService\n{\n    private readonly string _database;\n    public CoreService(string database) => _database = database;\n    public string HealthSummary(string name) => $"{name} ready on {_database}";\n}\n`,
      },
      {
        path: 'README.md',
        language: 'markdown',
        content: `# ${projectName} (C# .NET 8 · Demo Mode)\n\n\`\`\`bash\ndotnet run\n\`\`\`\n`,
      },
    ];
    return {
      projectName,
      language,
      framework,
      database,
      architectureOverview: `[Demo Mode] .NET 8 C# modular project with Services namespace and strict nullable checks.`,
      runInstructions: 'dotnet run',
      files: files.map((f) => ({ ...f, path: sanitizeArchivePath(f.path) })),
    };
  }

  if (lowerLang === 'php') {
    const files = [
      {
        path: 'composer.json',
        language: 'json',
        content: JSON.stringify(
          {
            name: `workspace/${safePkg}`,
            require: { php: '^8.2' },
            autoload: { 'psr-4': { 'App\\\\': 'src/' } },
          },
          null,
          2
        ),
      },
      {
        path: 'public/index.php',
        language: 'php',
        content: `<?php\nrequire_once __DIR__ . '/../src/CoreService.php';\nheader('Content-Type: application/json');\necho json_encode((new App\\CoreService('${database}'))->status('${projectName}'));\n`,
      },
      {
        path: 'src/CoreService.php',
        language: 'php',
        content: `<?php\nnamespace App;\n\nclass CoreService {\n    public function __construct(private string $database) {}\n    public function status(string $service): array {\n        return ['service' => $service, 'database' => $this->database, 'status' => 'healthy'];\n    }\n}\n`,
      },
      {
        path: 'README.md',
        language: 'markdown',
        content: `# ${projectName} (PHP 8.2 · Demo Mode)\n\n\`\`\`bash\nphp -S localhost:8000 -t public\n\`\`\`\n`,
      },
    ];
    return {
      projectName,
      language,
      framework,
      database,
      architectureOverview: `[Demo Mode] PSR-4 compliant PHP 8.2 project with front-controller entry point and service class.`,
      runInstructions: 'php -S localhost:8000 -t public',
      files: files.map((f) => ({ ...f, path: sanitizeArchivePath(f.path) })),
    };
  }

  if (lowerLang === 'javascript') {
    const files = [
      {
        path: 'package.json',
        language: 'json',
        content: JSON.stringify(
          {
            name: safePkg,
            version: '1.0.0',
            private: true,
            type: 'module',
            scripts: {
              start: 'node src/server.js',
              test: 'node --test',
            },
            dependencies: {
              express: '^4.21.2',
            },
          },
          null,
          2
        ),
      },
      {
        path: 'src/server.js',
        language: 'javascript',
        content: `import express from 'express';
import { validateRequest } from './middleware/validate.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: '${projectName}', status: 'healthy', database: '${database}' });
});

app.post('/api/v1/records', validateRequest, (req, res) => {
  res.status(201).json({ id: 'rec_' + Date.now(), payload: req.body });
});

export default app;
`,
      },
      {
        path: 'src/middleware/validate.js',
        language: 'javascript',
        content: `export function validateRequest(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || !req.body.name) {
    return res.status(400).json({ error: 'Field "name" is required.' });
  }
  next();
}
`,
      },
      {
        path: 'tests/server.test.js',
        language: 'javascript',
        content: `import test from 'node:test';
import assert from 'node:assert/strict';

test('payload validation sanity check', () => {
  assert.equal(Boolean('demo'.trim()), true);
});
`,
      },
      {
        path: 'README.md',
        language: 'markdown',
        content: `# ${projectName} (Demo Mode Template)\n\nGenerated locally in Demo Mode (${language} / ${framework}).\n\n\`\`\`bash\nnpm install\nnpm test\n\`\`\`\n`,
      },
    ];

    return {
      projectName,
      language,
      framework,
      database,
      architectureOverview: `[Demo Mode] Modular Node.js (${framework}) service with input validation middleware, health checks, and test runner.`,
      runInstructions: 'npm install && npm start',
      files: files.map((f) => ({ ...f, path: sanitizeArchivePath(f.path) })),
    };
  }

  // Default: TypeScript multi-file scaffold
  const files = [
    {
      path: 'package.json',
      language: 'json',
      content: JSON.stringify(
        {
          name: safePkg,
          version: '1.0.0',
          private: true,
          type: 'module',
          scripts: {
            dev: 'tsx src/index.ts',
            build: 'tsc',
            test: 'node --test',
          },
          dependencies: {
            express: '^4.21.2',
            ...(database === 'PostgreSQL' ? { pg: '^8.13.0' } : {}),
          },
          devDependencies: {
            typescript: '^5.7.0',
            tsx: '^4.19.0',
          },
        },
        null,
        2
      ),
    },
    {
      path: 'tsconfig.json',
      language: 'json',
      content: JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            outDir: './dist',
          },
          include: ['src/**/*'],
        },
        null,
        2
      ),
    },
    {
      path: 'src/index.ts',
      language: 'typescript',
      content: `import express from 'express';
import { healthRouter } from './routes/health';
import { authGuard } from './middleware/authGuard';

const app = express();
app.use(express.json());

app.use('/health', healthRouter);

app.post('/api/v1/orders', authGuard, (req, res) => {
  const { sku, quantity } = req.body || {};
  if (!sku || typeof quantity !== 'number' || quantity <= 0) {
    return res.status(400).json({ error: 'Invalid order payload' });
  }
  return res.status(201).json({
    orderId: 'ord_' + Date.now(),
    sku,
    quantity,
    status: 'CONFIRMED',
  });
});

export default app;
`,
    },
    {
      path: 'src/routes/health.ts',
      language: 'typescript',
      content: `import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    service: '${projectName}',
    language: '${language}',
    framework: '${framework}',
    database: '${database}',
    status: 'healthy',
    uptimeSeconds: Math.floor(process.uptime()),
  });
});
`,
    },
    {
      path: 'src/middleware/authGuard.ts',
      language: 'typescript',
      content: `import { Request, Response, NextFunction } from 'express';

export function authGuard(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Bearer authorization token' });
  }
  next();
}
`,
    },
    {
      path: 'README.md',
      language: 'markdown',
      content: `# ${projectName}

> Generated locally in **Demo Mode** without calling external AI APIs.

- **Stack:** ${language} · ${framework}
- **Database:** ${database}
- **Specification:** ${summaryDesc}

## Quickstart
\`\`\`bash
npm install
npm run dev
\`\`\`
`,
    },
  ];

  return {
    projectName,
    language,
    framework,
    database,
    architectureOverview: `[Demo Mode] Layered ${language} (${framework}) service architecture with modular health routing, auth guard middleware, and ${database} integration profile.`,
    runInstructions: 'npm install && npm run dev',
    files: files.map((f) => ({ ...f, path: sanitizeArchivePath(f.path) })),
  };
}

export function generateDemoCodeModification(options: {
  instruction: string;
  files: Array<{ path: string; content: string; language: string }>;
}): { summary: string; modifiedFiles: ModifiedFile[] } {
  const noteText =
    options.instruction.trim() || 'Add request rate-limiting helper and audit security constant';
  const targetFile =
    options.files.find(
      (f) =>
        f.path.includes('index') ||
        f.path.includes('main') ||
        f.path.includes('server') ||
        f.path.endsWith('.java') ||
        f.path.endsWith('.cpp') ||
        f.path.endsWith('.c')
    ) || options.files[0];

  const allPaths = options.files.map((f) => f.path.toLowerCase()).join(' ');
  const isPython = targetFile?.path.endsWith('.py') || /\.py\b/.test(allPaths);
  const isJava = targetFile?.path.endsWith('.java') || /\.java\b/.test(allPaths);
  const isCpp = targetFile?.path.endsWith('.cpp') || /\.cpp\b/.test(allPaths);
  const isC = !isCpp && (targetFile?.path.endsWith('.c') || /\.c\b/.test(allPaths));
  const isJs = targetFile?.path.endsWith('.js');
  const modifiedFiles: ModifiedFile[] = [];

  if (targetFile) {
    let updatedContent = targetFile.content.trimEnd();
    if (isPython) {
      updatedContent += `\n\n# Demo Mode Modification: ${noteText}\nAUDIT_SECURITY_HEADER = "X-Workspace-Verified"\n`;
    } else if (isJava) {
      updatedContent += `\n// Demo Mode Modification: ${noteText}\n// Security header verified cleanly in Demo Mode\n`;
    } else if (isCpp || isC) {
      updatedContent += `\n/* Demo Mode Modification: ${noteText} */\n`;
    } else {
      updatedContent += `\n\n// Demo Mode Modification: ${noteText}\nexport const AUDIT_SECURITY_HEADER = 'X-Workspace-Verified';\n`;
    }

    modifiedFiles.push({
      path: targetFile.path,
      language: targetFile.language,
      action: 'modified',
      changeDescription: `[Demo Mode] Applied local structural update for: ${noteText}`,
      content: updatedContent,
    });
  }

  if (isPython) {
    modifiedFiles.push({
      path: 'app/rate_limiter.py',
      language: 'python',
      action: 'added',
      changeDescription: '[Demo Mode] Added Python rate-limiting utility module',
      content: `def check_rate_limit(client_key: str, max_per_min: int = 60) -> bool:\n    return bool(client_key) and max_per_min > 0\n`,
    });
  } else if (isJava) {
    modifiedFiles.push({
      path: 'src/main/java/com/workspace/RateLimiter.java',
      language: 'java',
      action: 'added',
      changeDescription: '[Demo Mode] Added Java rate-limiting utility class',
      content: `package com.workspace;\n\npublic final class RateLimiter {\n    public static boolean allowRequest(String clientKey, int maxPerMin) {\n        return clientKey != null && !clientKey.isBlank() && maxPerMin > 0;\n    }\n}\n`,
    });
  } else if (isCpp) {
    modifiedFiles.push({
      path: 'include/rate_limiter.hpp',
      language: 'cpp',
      action: 'added',
      changeDescription: '[Demo Mode] Added C++ rate-limiting header helper',
      content: `#pragma once\n#include <string>\n\ninline bool allowRequest(const std::string& clientKey, int maxPerMin = 60) {\n    return !clientKey.empty() && maxPerMin > 0;\n}\n`,
    });
  } else if (isC) {
    modifiedFiles.push({
      path: 'include/rate_limiter.h',
      language: 'c',
      action: 'added',
      changeDescription: '[Demo Mode] Added C rate-limiting header helper',
      content: `#ifndef RATE_LIMITER_H\n#define RATE_LIMITER_H\nstatic inline int allow_request(const char* client_key, int max_per_min) {\n    return client_key != NULL && client_key[0] != '\\0' && max_per_min > 0;\n}\n#endif\n`,
    });
  } else if (isJs) {
    modifiedFiles.push({
      path: 'src/utils/rateLimiter.js',
      language: 'javascript',
      action: 'added',
      changeDescription: '[Demo Mode] Added deterministic JavaScript rate-limiting helper',
      content: `export function checkRateLimit(clientKey, maxPerMin = 60) {\n  return Boolean(clientKey) && maxPerMin > 0;\n}\n`,
    });
  } else {
    modifiedFiles.push({
      path: 'src/utils/rateLimiter.ts',
      language: 'typescript',
      action: 'added',
      changeDescription: '[Demo Mode] Added deterministic TypeScript rate-limiting utility module',
      content: `export function checkRateLimit(clientKey: string, maxPerMin = 60): boolean {\n  return Boolean(clientKey) && maxPerMin > 0;\n}\n`,
    });
  }

  return {
    summary: `[Demo Mode] Proposed modification: ${noteText}`,
    modifiedFiles,
  };
}

// ============================================================================
// AGENT 2: WEBSITE GENERATOR DEMO ENGINE
// ============================================================================

function buildReactSkeletonFiles(websiteName: string): WebsiteManifestFile[] {
  const pkgSlug =
    websiteName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'generated-site';
  return [
    {
      path: 'package.json',
      type: 'config',
      content: JSON.stringify(
        {
          name: pkgSlug,
          private: true,
          version: '1.0.0',
          type: 'module',
          scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
          dependencies: {
            react: '^19.0.0',
            'react-dom': '^19.0.0',
            'lucide-react': '^0.546.0',
          },
          devDependencies: {
            vite: '^6.0.0',
            '@vitejs/plugin-react': '^4.3.0',
            tailwindcss: '^3.4.0',
          },
        },
        null,
        2
      ),
    },
    {
      path: 'index.html',
      type: 'markup',
      content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${websiteName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`,
    },
    {
      path: 'vite.config.js',
      type: 'config',
      content: `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });`,
    },
    {
      path: 'src/main.jsx',
      type: 'source',
      content: `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './index.css';\n\ncreateRoot(document.getElementById('root')).render(<App />);`,
    },
    {
      path: 'src/index.css',
      type: 'style',
      content: `@import "tailwindcss";`,
    },
  ];
}

function getEcommerceReactManifest(websiteName: string, designDirection: string): WebsiteManifestFile[] {
  const isLight = designDirection.toLowerCase().includes('light');
  const bg = isLight ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100';
  const card = isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800';
  const safeName = websiteName.replace(/"/g, '\\"');
  return [
    ...buildReactSkeletonFiles(websiteName),
    {
      path: 'src/components/CartDrawer.jsx',
      type: 'source',
      content: `import React from 'react';
import { ShoppingCart, Plus, Minus, Trash2 } from 'lucide-react';

export function CartDrawer({ items, onUpdateQty, onCheckout, checkoutDone }) {
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);

  return (
    <aside className="p-5 rounded-xl border ${card} space-y-4 text-left">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-sm">
          <ShoppingCart size={16} className="text-emerald-400" />
          <span>Shopping Cart ({items.reduce((s, i) => s + i.qty, 0)})</span>
        </div>
        <span className="font-mono text-sm font-bold text-emerald-400">\${total.toFixed(2)}</span>
      </div>

      {items.length === 0 ? (
        <p className="text-xs opacity-70">Your cart is empty. Add items from the catalog.</p>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 text-xs border-b border-slate-700/40 pb-2">
              <div>
                <div className="font-semibold">{item.name}</div>
                <div className="opacity-70">\${item.price.toFixed(2)} each</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => onUpdateQty(item.id, -1)} className="p-1 rounded bg-slate-800 text-white" aria-label="Decrease">
                  <Minus size={12} />
                </button>
                <span className="font-mono w-5 text-center">{item.qty}</span>
                <button onClick={() => onUpdateQty(item.id, 1)} className="p-1 rounded bg-slate-800 text-white" aria-label="Increase">
                  <Plus size={12} />
                </button>
                <button onClick={() => onUpdateQty(item.id, -item.qty)} className="p-1 rounded text-rose-400" aria-label="Remove">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={onCheckout}
            className="w-full py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
          >
            Complete Order Summary (\${total.toFixed(2)})
          </button>
        </div>
      )}

      {checkoutDone && (
        <p className="text-xs text-emerald-400 font-medium">
          Order summary validated locally in Demo Mode preview.
        </p>
      )}
    </aside>
  );
}`,
    },
    {
      path: 'src/App.jsx',
      type: 'source',
      content: `import React, { useState } from 'react';
import { Store, Search } from 'lucide-react';
import { CartDrawer } from './components/CartDrawer';

const PRODUCTS = [
  { id: 'p1', name: 'Studio Mechanical Keyboard', category: 'Hardware', price: 149.0 },
  { id: 'p2', name: 'USB-C NVMe Dock Pro', category: 'Accessories', price: 89.0 },
  { id: 'p3', name: 'Noise-Isolating Headset', category: 'Audio', price: 199.0 },
  { id: 'p4', name: 'Precision Vertical Mouse', category: 'Hardware', price: 79.0 },
];

export default function App() {
  const [filterCat, setFilterCat] = useState('All');
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState([{ id: 'p1', name: 'Studio Mechanical Keyboard', price: 149.0, qty: 1 }]);
  const [checkoutDone, setCheckoutDone] = useState(false);

  const visibleProducts = PRODUCTS.filter((p) => {
    const matchCat = filterCat === 'All' || p.category === filterCat;
    const matchQ = !query.trim() || p.name.toLowerCase().includes(query.toLowerCase());
    return matchCat && matchQ;
  });

  const addToCart = (prod) => {
    setCheckoutDone(false);
    setCart((prev) => {
      const existing = prev.find((i) => i.id === prod.id);
      if (existing) return prev.map((i) => (i.id === prod.id ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { ...prod, qty: 1 }];
    });
  };

  const updateQty = (id, delta) => {
    setCheckoutDone(false);
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0)
    );
  };

  return (
    <div className="min-h-screen ${bg} flex flex-col">
      <header className="border-b border-slate-800/70 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-lg">
          <Store size={20} className="text-emerald-400" />
          <span>${safeName}</span>
        </div>
        <span className="text-xs font-mono opacity-75">E-Commerce Storefront · Demo Mode</span>
      </header>

      <main className="max-w-6xl w-full mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        <div className="lg:col-span-2 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {['All', 'Hardware', 'Accessories', 'Audio'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCat(cat)}
                  className={filterCat === cat ? 'px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold' : 'px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs'}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border ${card}">
              <Search size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products..."
                className="bg-transparent text-xs outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visibleProducts.map((prod) => (
              <div key={prod.id} className="p-5 rounded-xl border ${card} flex flex-col justify-between gap-3">
                <div>
                  <span className="text-[11px] font-mono text-emerald-400 uppercase">{prod.category}</span>
                  <h3 className="text-base font-semibold mt-1">{prod.name}</h3>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-700/40">
                  <span className="font-bold text-sm">\${prod.price.toFixed(2)}</span>
                  <button
                    onClick={() => addToCart(prod)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                  >
                    Add to Cart
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <CartDrawer
            items={cart}
            onUpdateQty={updateQty}
            onCheckout={() => setCheckoutDone(true)}
            checkoutDone={checkoutDone}
          />
        </div>
      </main>
    </div>
  );
}`,
    },
    {
      path: 'README.md',
      type: 'doc',
      content: `# ${websiteName}\n\nMulti-component React E-Commerce demo generated in offline Demo Mode.\n`,
    },
  ];
}

function getPortfolioReactManifest(websiteName: string, designDirection: string): WebsiteManifestFile[] {
  const isLight = designDirection.toLowerCase().includes('light');
  const bg = isLight ? 'bg-slate-50 text-slate-900' : 'bg-zinc-950 text-zinc-100';
  const card = isLight ? 'bg-white border-slate-200' : 'bg-zinc-900 border-zinc-800';
  const safeName = websiteName.replace(/"/g, '\\"');
  return [
    ...buildReactSkeletonFiles(websiteName),
    {
      path: 'src/components/ProjectCard.jsx',
      type: 'source',
      content: `import React from 'react';
import { Code2 } from 'lucide-react';

export function ProjectCard({ project }) {
  return (
    <article className="p-5 rounded-xl border ${card} text-left space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-violet-400 uppercase">{project.stack}</span>
        <Code2 size={15} className="text-violet-400" />
      </div>
      <h3 className="text-base font-bold">{project.title}</h3>
      <p className="text-xs opacity-80 leading-relaxed">{project.summary}</p>
    </article>
  );
}`,
    },
    {
      path: 'src/App.jsx',
      type: 'source',
      content: `import React, { useState } from 'react';
import { Terminal } from 'lucide-react';
import { ProjectCard } from './components/ProjectCard';

const PROJECTS = [
  { id: '1', stack: 'TypeScript · React', title: 'Distributed Telemetry Console', summary: 'Real-time worker queue monitor with filterable traces.' },
  { id: '2', stack: 'Python · FastAPI', title: 'Document Parser Pipeline', summary: 'Schema-validated document extraction microservice.' },
  { id: '3', stack: 'Go · PostgreSQL', title: 'Rate-Limit Gateway', summary: 'Deterministic sliding-window API protection layer.' },
];

export default function App() {
  const [filter, setFilter] = useState('All');
  const [message, setMessage] = useState('');
  const [sentNote, setSentNote] = useState('');

  const filtered = filter === 'All' ? PROJECTS : PROJECTS.filter((p) => p.stack.includes(filter));

  return (
    <div className="min-h-screen ${bg} flex flex-col">
      <header className="border-b border-zinc-800/70 px-6 py-4 flex items-center justify-between max-w-5xl w-full mx-auto">
        <div className="flex items-center gap-2 font-bold text-base">
          <Terminal size={18} className="text-violet-400" />
          <span>${safeName}</span>
        </div>
        <div className="flex gap-2">
          {['All', 'React', 'Python', 'Go'].map((tag) => (
            <button
              key={tag}
              onClick={() => setFilter(tag)}
              className={filter === tag ? 'px-3 py-1 rounded bg-violet-600 text-white text-xs font-semibold' : 'px-3 py-1 rounded bg-zinc-800 text-zinc-300 text-xs'}
            >
              {tag}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl w-full mx-auto px-6 py-10 space-y-10 flex-1">
        <section className="space-y-3">
          <span className="text-xs font-mono text-violet-400 uppercase tracking-widest">Developer Portfolio</span>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">${safeName}</h1>
          <p className="text-sm opacity-80 max-w-2xl">Full-stack systems architecture, clean API design, and verifiable automated test suites.</p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </section>

        <section className="p-6 rounded-xl border ${card} max-w-xl space-y-3">
          <h2 className="text-base font-bold">Send Project Inquiry</h2>
          <textarea
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Share scope or engineering goals..."
            className="w-full p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-700 text-xs"
          />
          <button
            onClick={() => setSentNote(message.trim() ? 'Inquiry validated in Demo Mode preview.' : 'Please type a short message first.')}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold"
          >
            Validate Message
          </button>
          {sentNote && <p className="text-xs text-emerald-400">{sentNote}</p>}
        </section>
      </main>
    </div>
  );
}`,
    },
    {
      path: 'README.md',
      type: 'doc',
      content: `# ${websiteName}\n\nDeveloper portfolio React application generated in Demo Mode.\n`,
    },
  ];
}

function getEducationEventsReactManifest(websiteName: string, designDirection: string): WebsiteManifestFile[] {
  const isLight = designDirection.toLowerCase().includes('light');
  const bg = isLight ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100';
  const card = isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800';
  const safeName = websiteName.replace(/"/g, '\\"');
  return [
    ...buildReactSkeletonFiles(websiteName),
    {
      path: 'src/App.jsx',
      type: 'source',
      content: `import React, { useState } from 'react';
import { Calendar, CheckCircle2 } from 'lucide-react';

const SESSIONS = [
  { id: 'e1', track: 'Technical', title: 'Distributed Systems Symposium', room: 'Auditorium A', seats: 120 },
  { id: 'e2', track: 'Workshop', title: 'React & TypeScript Hands-On Lab', room: 'Lab 204', seats: 45 },
  { id: 'e3', track: 'Hackathon', title: '24-Hour Engineering Sprint', room: 'Innovation Hall', seats: 200 },
];

export default function App() {
  const [track, setTrack] = useState('All');
  const [registered, setRegistered] = useState([]);
  const [studentName, setStudentName] = useState('');

  const visible = track === 'All' ? SESSIONS : SESSIONS.filter((s) => s.track === track);

  const toggleRegister = (id) => {
    setRegistered((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="min-h-screen ${bg} flex flex-col">
      <header className="border-b border-slate-800/70 px-6 py-4 flex items-center justify-between max-w-5xl w-full mx-auto">
        <div className="flex items-center gap-2 font-bold text-lg">
          <Calendar size={18} className="text-indigo-400" />
          <span>${safeName}</span>
        </div>
        <span className="text-xs font-mono text-emerald-400">Registered: {registered.length} events</span>
      </header>

      <main className="max-w-5xl w-full mx-auto px-6 py-8 space-y-6 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {['All', 'Technical', 'Workshop', 'Hackathon'].map((t) => (
              <button
                key={t}
                onClick={() => setTrack(t)}
                className={track === t ? 'px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold' : 'px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs'}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="Participant name..."
            className="px-3 py-1.5 rounded-lg border ${card} text-xs"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {visible.map((ev) => {
            const isJoined = registered.includes(ev.id);
            return (
              <div key={ev.id} className="p-5 rounded-xl border ${card} space-y-3 text-left">
                <span className="text-[11px] font-mono text-indigo-400 uppercase">{ev.track} · {ev.room}</span>
                <h3 className="text-base font-bold">{ev.title}</h3>
                <p className="text-xs opacity-75">Capacity: {ev.seats} participants</p>
                <button
                  onClick={() => toggleRegister(ev.id)}
                  className={isJoined ? 'w-full py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold flex items-center justify-center gap-1' : 'w-full py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold'}
                >
                  {isJoined && <CheckCircle2 size={13} />}
                  <span>{isJoined ? 'Registered' : 'RSVP Session'}</span>
                </button>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}`,
    },
    {
      path: 'README.md',
      type: 'doc',
      content: `# ${websiteName}\n\nCampus & education event management React application generated in Demo Mode.\n`,
    },
  ];
}

export function getSampleHtmlWebsiteManifest(
  websiteName = 'Apex Cloud Platform',
  category = 'SaaS',
  designDirection = 'Dark'
): WebsiteManifestFile[] {
  const cleanName = websiteName.trim() || 'Apex Cloud Platform';
  const isLight = designDirection.toLowerCase() === 'light';
  const bg = isLight ? '#f8fafc' : '#09090b';
  const cardBg = isLight ? '#ffffff' : '#111116';
  const textPrimary = isLight ? '#0f172a' : '#f8fafc';
  const textSecondary = isLight ? '#475569' : '#a1a1aa';
  const borderCol = isLight ? '#e2e8f0' : '#27272a';

  return [
    {
      path: 'index.html',
      type: 'markup',
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${cleanName}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="navbar">
    <div class="container nav-inner">
      <div class="brand">${cleanName}</div>
      <nav class="nav-links">
        <a href="#features">Capabilities</a>
        <a href="#metrics">Metrics</a>
        <a href="#contact">Contact</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero container">
      <span class="badge">${category} · Demo Mode Static Bundle</span>
      <h1>Build Reliable ${category} Experiences with ${cleanName}</h1>
      <p>Clean multi-file HTML, CSS, and ES6 JavaScript bundle running safely inside the sandboxed preview without external network dependencies.</p>
      <div class="actions">
        <a href="#contact" class="btn-primary">Request Walkthrough</a>
        <a href="#features" class="btn-secondary">Explore Architecture</a>
      </div>
    </section>

    <section id="features" class="container grid-3">
      <article class="card">
        <h3>Deterministic Build</h3>
        <p>Semantic HTML5 markup paired with responsive CSS Grid and strict Content Security Policy isolation.</p>
      </article>
      <article class="card">
        <h3>Zero External Assets</h3>
        <p>Inline vector graphics and system typography ensure instant preview rendering offline or in Demo Mode.</p>
      </article>
      <article class="card">
        <h3>Interactive Validation</h3>
        <p>Client-side form validation demonstrates real feedback states cleanly in preview mode.</p>
      </article>
    </section>

    <section id="metrics" class="container stats-bar">
      <div><strong>99.95%</strong><span>Availability Target</span></div>
      <div><strong>&lt; 25ms</strong><span>Preview Compile Time</span></div>
      <div><strong>4 Files</strong><span>Export-Ready ZIP</span></div>
    </section>

    <section id="contact" class="container contact-box">
      <h2>Validate Inquiry Form</h2>
      <form id="demo-contact-form">
        <input id="contact-email" type="email" placeholder="engineer@company.com" required />
        <input id="contact-note" type="text" placeholder="Describe your deployment goals..." required />
        <button type="submit" class="btn-primary">Validate Input</button>
      </form>
      <p id="form-feedback" class="feedback" aria-live="polite"></p>
    </section>
  </main>

  <footer class="container footer">
    <span>${cleanName} · Generated in Demo Mode</span>
  </footer>

  <script src="app.js"></script>
</body>
</html>`,
    },
    {
      path: 'styles.css',
      type: 'style',
      content: `:root {
  --bg: ${bg};
  --card: ${cardBg};
  --text: ${textPrimary};
  --muted: ${textSecondary};
  --border: ${borderCol};
  --accent: #7c3aed;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}
.container { max-width: 1040px; margin: 0 auto; padding: 0 20px; }
.navbar { border-bottom: 1px solid var(--border); padding: 16px 0; }
.nav-inner { display: flex; justify-content: space-between; align-items: center; }
.brand { font-weight: 700; font-size: 1.05rem; }
.nav-links { display: flex; gap: 20px; }
.nav-links a { color: var(--muted); text-decoration: none; font-size: 0.9rem; }
.hero { padding: 64px 20px 40px; text-align: center; }
.badge { display: inline-block; padding: 4px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.75rem; color: var(--muted); }
.hero h1 { font-size: 2.35rem; margin: 16px auto; max-width: 720px; line-height: 1.15; }
.hero p { color: var(--muted); max-width: 600px; margin: 0 auto 24px; }
.actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
.btn-primary { background: var(--accent); color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; border: none; font-weight: 600; cursor: pointer; }
.btn-secondary { border: 1px solid var(--border); color: var(--text); padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; }
.grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 32px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
.card h3 { margin-top: 0; font-size: 1.05rem; }
.card p { color: var(--muted); font-size: 0.9rem; margin-bottom: 0; }
.stats-bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 24px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; text-align: center; margin-bottom: 32px; }
.stats-bar strong { display: block; font-size: 1.4rem; color: #a78bfa; }
.stats-bar span { font-size: 0.8rem; color: var(--muted); }
.contact-box { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 40px; }
#demo-contact-form { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
#demo-contact-form input { flex: 1; min-width: 180px; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); }
.feedback { margin-top: 10px; font-size: 0.85rem; color: #34d399; }
.footer { border-top: 1px solid var(--border); padding: 20px; text-align: center; color: var(--muted); font-size: 0.85rem; }
`,
    },
    {
      path: 'app.js',
      type: 'source',
      content: `document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('demo-contact-form');
  const feedback = document.getElementById('form-feedback');
  if (!form || !feedback) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = document.getElementById('contact-email')?.value?.trim() || '';
    const note = document.getElementById('contact-note')?.value?.trim() || '';
    if (!email.includes('@') || !note) {
      feedback.textContent = 'Please provide a valid email address and deployment goal.';
      return;
    }
    feedback.textContent = 'Input validated locally in Demo Mode preview (no backend message sent).';
    form.reset();
  });
});
`,
    },
    {
      path: 'README.md',
      type: 'doc',
      content: `# ${cleanName}\n\nStatic HTML/CSS/JS Demo Mode bundle (${category} · ${designDirection}). Open \`index.html\` or preview directly in the workspace sandbox.\n`,
    },
  ];
}

export function generateDemoWebsiteProject(options: {
  websiteName?: string;
  category?: string;
  technology?: string;
  designDirection?: string;
  description?: string;
}): DemoWebsiteProjectPayload {
  const websiteName = (options.websiteName || 'Apex Cloud Platform').trim() || 'Apex Cloud Platform';
  const category = (options.category || 'SaaS').trim();
  const technology = (options.technology || 'React').trim();
  const designDirection = (options.designDirection || 'Dark').trim();
  const combinedHint = `${category} ${websiteName} ${options.description || ''}`.toLowerCase();

  const isHtmlStatic = technology.toLowerCase().includes('html');
  let fileManifest: WebsiteManifestFile[];

  if (isHtmlStatic) {
    fileManifest = getSampleHtmlWebsiteManifest(websiteName, category, designDirection);
  } else if (/e-?commerce|store|shop|cart|product/i.test(combinedHint)) {
    fileManifest = getEcommerceReactManifest(websiteName, designDirection);
  } else if (/portfolio|developer|resume|showcase/i.test(combinedHint)) {
    fileManifest = getPortfolioReactManifest(websiteName, designDirection);
  } else if (/college|university|campus|event|education|conference/i.test(combinedHint)) {
    fileManifest = getEducationEventsReactManifest(websiteName, designDirection);
  } else {
    fileManifest = getSampleReactWebsiteManifest(websiteName);
  }

  return {
    websiteName,
    category,
    technology: isHtmlStatic ? 'HTML / CSS / JS' : 'React',
    designDirection,
    summary: isHtmlStatic
      ? `[Demo Mode] Complete multi-file HTML/CSS/JS ${category} site (${designDirection}) ready for live preview, editing, and ZIP export.`
      : `[Demo Mode] Complete multi-file React 19 + Vite ${category} application (${designDirection}) tailored cleanly for ${websiteName}.`,
    fileManifest,
  };
}

// ============================================================================
// AGENT 3: DOCUMENT GENERATOR DEMO ENGINE
// ============================================================================

export function generateDemoDocumentData(options: {
  title?: string;
  documentType?: string;
  pageCount?: string;
  prompt?: string;
}): DemoDocumentPayload {
  const title =
    (options.title || 'AI Engineering Workspace — System Architecture Report').trim();
  const documentType = (options.documentType || 'Technical Project Report').trim();
  const pageCount = (options.pageCount || 'Standard (3-5 pages)').trim();
  const promptSummary = (options.prompt || '').trim();

  const isBrief = /brief|1-2/i.test(pageCount);
  const isDetailed = /detailed|comprehensive|6-10|12-15|\b(?:[6-9]|[1-9]\d+)\s*page/i.test(
    pageCount
  );

  const scopeNote = promptSummary
    ? `Document scope reflects the provided instructions: "${promptSummary.slice(0, 260)}${
        promptSummary.length > 260 ? '...' : ''
      }"`
    : 'This document was generated using deterministic offline Demo Mode templates so you can inspect, edit Markdown, save, and compile OpenXML (.docx) exports without API quota.';

  const sections: DemoDocumentPayload['sections'] = [
    {
      heading: '1. Executive Summary',
      level: 1,
      paragraphs: [
        `${title} is structured as a ${documentType} calibrated for "${pageCount}" depth.`,
        scopeNote,
      ],
      bullets: [
        'Deterministic Demo Mode execution with zero live Gemini API calls',
        'Editable Markdown source synchronized with OpenXML (.docx) compilation',
        'Owner-isolated persistence across workspace sessions',
      ],
    },
    {
      heading: '2. System Architecture & Component Matrix',
      level: 2,
      paragraphs: [
        'The table below summarizes the four independent engineering agents and their verified artifact outputs:',
      ],
      bullets: [],
    },
    {
      heading: '3. Verification & Delivery Checklist',
      level: 2,
      paragraphs: [
        'Follow the structured verification workflow below before final academic or engineering sign-off:',
      ],
      bullets: [
        'Verify authentication and owner-scoped Firestore rules before saving snapshots',
        'Inspect generated Markdown sections and edit inline prior to DOCX compilation',
      ],
    },
  ];

  const markdownParts: string[] = [
    `# ${title}`,
    '',
    `> **Demo Mode Output** · Document Type: ${documentType} · Target Length: ${pageCount}`,
    '',
    '## 1. Executive Summary',
    '',
    `${title} is formatted as a **${documentType}** tailored for **${pageCount}** coverage.`,
    '',
    scopeNote,
    '',
    '- Deterministic Demo Mode execution with zero live Gemini API calls',
    '- Editable Markdown preview synchronized with native OpenXML (.docx) compilation',
    '- Clear separation of placeholder assumptions (`[Project Detail Needed]`) from verified specifications',
    '',
    '## 2. Four-Agent Architecture Overview',
    '',
    '| Agent | Primary Responsibility | Verified Export |',
    '| --- | --- | --- |',
    '| Code Generator | Multi-file software synthesis & diff review | .zip Archive |',
    '| Website Generator | React/Vite manifest & isolated preview | .zip + Published Link |',
    '| Document Generator | Prompt-driven structured authoring | .docx & Markdown |',
    '| Data Cleaner | Natural-language tabular profiling & cleaning | .csv & .xlsx |',
  ];

  if (!isBrief) {
    markdownParts.push(
      '',
      '## 3. Verification & Delivery Workflow',
      '',
      '1. Validate authentication via Firebase Auth and salted HMAC-SHA256 email verification.',
      '2. Enforce quota-safe request handling with duplicate suppression and timeouts.',
      '3. Export verified artifacts directly without mutating original source data.'
    );
  }

  if (isDetailed) {
    sections.push(
      {
        heading: '4. Reliability, Quota Protection & Security Controls',
        level: 2,
        paragraphs: [
          'Detailed safeguards protect backend stability during transient provider unavailability and quota limits.',
        ],
        bullets: [
          'Server-side Request Manager deduplicates concurrent submissions per user scope',
          'Bounded exponential backoff applies strictly to transient 503/network failures',
          'HTTP 429 quota responses fail fast and preserve user state for Demo Mode fallback',
        ],
      },
      {
        heading: '5. Assumptions & Scope Notes',
        level: 2,
        paragraphs: [
          '[Assumption / Project Detail Needed]: Replace demo metric placeholders with measured benchmark figures from your evaluation run.',
        ],
        bullets: [],
      }
    );

    markdownParts.push(
      '',
      '## 4. Reliability, Quota Protection & Security Controls',
      '',
      '| Control Area | Mechanism | Engineering Guarantee |',
      '| --- | --- | --- |',
      '| Request Protection | In-flight deduplication + TTL cache | Eliminates duplicate submissions per user |',
      '| Quota Handling | Fail-fast HTTP 429 + cooldown timer | Prevents retry storms and preserves inputs |',
      '| Sandbox Security | Opaque-origin iframe + strict CSP | Blocks outbound exfiltration from previews |',
      '',
      '### 4.1 Operational Trade-Offs',
      '',
      'Live AI mode relies on external API availability and quota limits, whereas Demo Mode guarantees deterministic completion during offline demonstrations and academic evaluations.',
      '',
      '## 5. Assumptions & Scope Notes',
      '',
      '- Quantitative benchmarks marked `[Project Detail Needed]` should be populated from actual test runs rather than estimated.',
      '- All existing Firestore security rules and Firebase ownership guarantees remain enforced during persistence.'
    );
  }

  return {
    title,
    subtitle: `${documentType} · Demo Mode (${pageCount})`,
    category: documentType,
    tone: 'Demo Mode Template',
    length: pageCount,
    sections,
    fullMarkdown: markdownParts.join('\n'),
  };
}

// ============================================================================
// AGENT 4: DATA CLEANER DETERMINISTIC DEMO-INTENT INTERPRETER
// ============================================================================

const CLEANING_ACTION_START_VERBS =
  '(?:remove|drop|delete|trim|strip|fill|replace|impute|standardize|normalize|convert|cast|rename|filter|keep|only|sort|order|reorder|move|split|merge|combine|clean|fix|clear|validate|deduplicate|dedup)';

function splitCompoundCleaningClauses(instruction: string): string[] {
  // Split cleanly at semicolons, newlines, ". " sentence boundaries, ", then ", " and then ",
  // commas or "and" ONLY when immediately introducing a new cleaning verb (never inside "email and phone columns" or "Male and Female")
  const normalized = instruction.trim().replace(/[.?!]+$/, '');
  const splitter = new RegExp(
    `\\s*(?:;|\\r?\\n|\\.\\s+|,\\s*then\\s+|\\s+and\\s+then\\s+|,\\s*(?=${CLEANING_ACTION_START_VERBS}\\b)|\\s+and\\s+(?=${CLEANING_ACTION_START_VERBS}\\b))\\s*`,
    'i'
  );
  return normalized
    .split(splitter)
    .map((c) => c.trim().replace(/[.;!]+$/, '').trim())
    .filter(Boolean);
}

function findAllMatchedColumns(fragment: string, columns: string[]): string[] {
  const normalizedFrag = fragment.toLowerCase();
  const sortedCols = [...columns].sort((a, b) => b.length - a.length);
  const hits: Array<{ col: string; index: number; len: number }> = [];

  for (const col of sortedCols) {
    const lowerCol = col.toLowerCase();
    const spacedCol = lowerCol.replace(/[_-]+/g, ' ');
    const escapedLower = lowerCol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedSpaced = spacedCol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|[^a-z0-9_])(${escapedLower})(?:$|[^a-z0-9_])`, 'i');
    const reSpaced = new RegExp(`(?:^|[^a-z0-9_])(${escapedSpaced})(?:$|[^a-z0-9_])`, 'i');

    const m1 = re.exec(normalizedFrag);
    const m2 = spacedCol !== lowerCol ? reSpaced.exec(normalizedFrag) : null;
    const m = m1 || m2;
    if (m && m.index !== undefined) {
      const start = m.index + (m[0].length - m[1].length) / 2; // approx
      const exactIdx = m.index;
      const overlaps = hits.some(
        (h) => exactIdx < h.index + h.len && exactIdx + col.length > h.index
      );
      if (!overlaps) {
        hits.push({ col, index: start, len: col.length });
      }
    }
  }

  return hits.sort((a, b) => a.index - b.index).map((h) => h.col);
}

function findMatchedColumn(fragment: string, columns: string[]): string | null {
  const all = findAllMatchedColumns(fragment, columns);
  return all.length > 0 ? all[0] : null;
}

const KNOWN_INSTRUCTION_STOPWORDS = new Set([
  'all', 'any', 'column', 'columns', 'col', 'row', 'rows', 'data', 'dataset',
  'table', 'values', 'value', 'missing', 'null', 'empty', 'whitespace', 'spaces',
  'duplicate', 'duplicates', 'invalid', 'outliers', 'outlier', 'text', 'strings',
  'string', 'dates', 'date', 'categories', 'category', 'mean', 'average', 'median',
  'mode', 'previous', 'prev', 'number', 'numeric', 'boolean', 'iso', 'first',
  'last', 'leading', 'trailing', 'uppercase', 'lowercase', 'titlecase', 'trim',
  'format', 'standardize', 'normalize', 'fill', 'drop', 'remove', 'delete',
  'clean', 'filter', 'keep', 'rename', 'convert', 'where', 'with', 'from',
  'into', 'using', 'iqr', 'zscore', 'male', 'female', 'na', 'sort', 'order',
  'reorder', 'split', 'merge', 'phone', 'phones', 'email', 'emails', 'cell', 'cells',
]);

function detectExplicitMissingColumn(clause: string, columns: string[]): string | null {
  const patterns = [
    /(?:column|col)\s+["']?([a-zA-Z_][a-zA-Z0-9_-]*)["']?/i,
    /(?:missing|in|from|on|of)\s+(?:the\s+)?["']?([a-zA-Z_][a-zA-Z0-9_-]*)["']?\s*(?:column|with|to|$)/i,
    /(?:standardize|normalize|convert|trim)\s+(?:the\s+)?["']?([a-zA-Z_][a-zA-Z0-9_-]*)["']?/i,
    /(?:rename|remove|delete|sort\s+by|order\s+by)\s+(?:column\s+)?["']?([a-zA-Z_][a-zA-Z0-9_-]*)["']?/i,
  ];
  const lowerCols = new Set(columns.map((c) => c.toLowerCase()));
  for (const re of patterns) {
    const match = clause.match(re);
    if (match && match[1]) {
      const candidate = match[1].trim();
      const lowerCand = candidate.toLowerCase();
      if (!KNOWN_INSTRUCTION_STOPWORDS.has(lowerCand) && !lowerCols.has(lowerCand)) {
        return candidate;
      }
    }
  }
  return null;
}

function buildCategoryMappingFromSample(
  column: string,
  sampleRows: Record<string, any>[],
  clauseLower: string
): { mapping: Record<string, string>; caseType?: 'titlecase' | 'lowercase' | 'uppercase' } {
  const mapping: Record<string, string> = {};

  // Gender standardization ("into Male and Female" or column named gender/sex)
  if (/male|female|\bgender\b/i.test(clauseLower) || /^(?:gender|sex)$/i.test(column)) {
    Object.assign(mapping, {
      m: 'Male',
      male: 'Male',
      man: 'Male',
      f: 'Female',
      female: 'Female',
      woman: 'Female',
    });
    for (const row of sampleRows) {
      const raw = row?.[column];
      if (typeof raw !== 'string') continue;
      const lower = raw.trim().toLowerCase();
      if (lower === 'm' || lower === 'male') mapping[raw.trim()] = 'Male';
      else if (lower === 'f' || lower === 'female') mapping[raw.trim()] = 'Female';
    }
    return { mapping };
  }

  const toTitle = (s: string) =>
    s
      .replace(/[-_]+/g, ' ')
      .replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());

  for (const row of sampleRows) {
    const raw = row?.[column];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();
    if (lower === 'in-active' || lower === 'in active') {
      mapping[trimmed] = 'Inactive';
    } else if (lower === 'active') {
      mapping[trimmed] = 'Active';
    } else if (lower === 'pending') {
      mapping[trimmed] = 'Pending';
    } else {
      mapping[trimmed] = toTitle(trimmed);
    }
  }
  return { mapping, caseType: 'titlecase' };
}

/**
 * Deterministic local natural-language cleaning interpreter used strictly in Demo Mode.
 * Zero Gemini API calls; transparently returns clarification or invalid_column feedback
 * when requests are vague or reference non-existent columns.
 */
export function interpretDemoCleaningInstruction(
  instruction: string,
  profile: Pick<DatasetAiProfile, 'columns' | 'columnTypes' | 'sampleRows'>
): DemoCleaningPlanResult {
  const cleanInstruction = (instruction || '').trim();
  const columns = Array.isArray(profile.columns) ? profile.columns : [];

  if (!cleanInstruction || columns.length === 0) {
    return {
      status: 'needs_clarification',
      explanation: 'Please provide a cleaning instruction and load a dataset first.',
      clarificationQuestion: `Available columns: ${columns.join(', ')}.`,
      operations: [],
      executionMode: 'demo',
    };
  }

  // Reject blatantly vague prompts without mutating data
  if (
    /^(?:clean\s+(?:the\s+)?(?:data|dataset|everything|it)|fix\s+(?:the\s+)?(?:data|dataset|errors|everything)|make\s+it\s+better|auto\s*clean|help)$/i.test(
      cleanInstruction.replace(/[.?!]+$/, '').trim()
    )
  ) {
    return {
      status: 'needs_clarification',
      explanation:
        'Demo Mode interpreter cannot safely guess unspecified transformations for a broad request.',
      clarificationQuestion: `Specify exact actions (e.g., "Remove duplicate rows, trim whitespace, fill missing age with mean") across columns: ${columns.join(', ')}.`,
      operations: [],
      executionMode: 'demo',
    };
  }

  const rawClauses = splitCompoundCleaningClauses(cleanInstruction);
  const operations: CleaningOperation[] = [];
  const explanations: string[] = [];

  for (let idx = 0; idx < rawClauses.length; idx++) {
    const clause = rawClauses[idx];
    const lower = clause.toLowerCase();
    const matchedCols = findAllMatchedColumns(clause, columns);
    const matchedCol = matchedCols[0] || null;
    const opId = `demo_op_${Date.now()}_${idx}`;

    // 0. Count-based column removal without column names -> Clarification & Column Picker Confirmation
    const countRemoveColsMatch = clause.match(
      /\b(?:remove|drop|delete)\s+(?:the\s+)?(\d+)\s+col(?:umn)?s?\b/i
    );
    if (countRemoveColsMatch && matchedCols.length === 0) {
      const requestedCount = Math.max(1, Number(countRemoveColsMatch[1]));
      return {
        status: 'needs_clarification',
        pendingColumnRemovalCount: requestedCount,
        explanation: `You asked to remove ${requestedCount} column(s), but did not specify which columns to drop.`,
        clarificationQuestion: `Please select the exact ${requestedCount} column(s) you want to remove before modifying the dataset schema.`,
        operations: [],
        executionMode: 'demo',
      };
    }

    // 1. Duplicate rows
    if (/duplicate|dedup/i.test(lower)) {
      const keep: 'first' | 'last' = /\blast\b/i.test(lower) ? 'last' : 'first';
      operations.push({
        id: opId,
        type: 'remove_duplicates',
        params: {
          ...(matchedCols.length > 0 ? { columns: matchedCols } : {}),
          keep,
        },
        description:
          matchedCols.length > 0
            ? `Remove duplicate rows by '${matchedCols.join(', ')}' (keep ${keep})`
            : `Remove duplicate rows (keep ${keep})`,
      });
      explanations.push(`removed duplicate rows (keep ${keep})`);
      continue;
    }

    // 2. Empty columns
    if (/empty\s+col/i.test(lower)) {
      operations.push({
        id: opId,
        type: 'remove_empty_columns',
        params: {},
        description: 'Remove completely empty columns',
      });
      explanations.push('removed empty columns');
      continue;
    }

    // 3. Empty rows
    if (/empty\s+row|blank\s+row/i.test(lower)) {
      operations.push({
        id: opId,
        type: 'remove_empty_rows',
        params: {},
        description: 'Remove completely empty rows',
      });
      explanations.push('removed empty rows');
      continue;
    }

    // 4. Trim whitespace
    if (/trim|whitespace|spaces/i.test(lower)) {
      if (matchedCols.length === 0) {
        const suspectMissing = detectExplicitMissingColumn(clause, columns);
        if (suspectMissing) {
          return {
            status: 'invalid_column',
            explanation: `Column '${suspectMissing}' was not found in the dataset.`,
            clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
            operations: [],
            executionMode: 'demo',
          };
        }
      }
      operations.push({
        id: opId,
        type: 'trim_whitespace',
        params: matchedCols.length > 0 ? { columns: matchedCols } : { column: 'ALL' },
        description:
          matchedCols.length > 0
            ? `Trim whitespace in '${matchedCols.join(', ')}'`
            : 'Trim leading and trailing whitespace across text columns',
      });
      explanations.push('trimmed whitespace');
      continue;
    }

    // 5. Invalid emails
    if (/email/i.test(lower) && /invalid|bad|malformed|valid|verify/i.test(lower)) {
      const emailCol = matchedCol || columns.find((c) => /email|mail/i.test(c));
      if (!emailCol) {
        return {
          status: 'invalid_column',
          explanation: 'No email column found in the dataset.',
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      const clearOnly = /\bclear\b|\bblank\b/i.test(lower);
      operations.push({
        id: opId,
        type: 'remove_invalid_emails',
        params: { column: emailCol, mode: clearOnly ? 'clear_cell' : 'drop_row' },
        description: clearOnly
          ? `Clear invalid email cells in '${emailCol}'`
          : `Remove rows with invalid emails in '${emailCol}'`,
      });
      explanations.push('validated email addresses');
      continue;
    }

    // 5b. Invalid phones
    if (/phone|mobile|tel/i.test(lower) && /invalid|bad|malformed|valid/i.test(lower)) {
      const phoneCol = matchedCol || columns.find((c) => /phone|mobile|tel/i.test(c));
      if (!phoneCol) {
        return {
          status: 'invalid_column',
          explanation: 'No phone column found in the dataset.',
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      const clearOnly = /\bclear\b|\bblank\b/i.test(lower);
      operations.push({
        id: opId,
        type: 'remove_invalid_phones',
        params: { column: phoneCol, mode: clearOnly ? 'clear_cell' : 'drop_row' },
        description: clearOnly
          ? `Clear invalid phone cells in '${phoneCol}'`
          : `Remove rows with invalid phone numbers in '${phoneCol}'`,
      });
      explanations.push('validated phone numbers');
      continue;
    }

    // 6. Standardize dates
    if (
      (/(?:^|[^a-z])date|yyyy-mm-dd|iso\s*date/i.test(lower) ||
        Boolean(matchedCol && (profile.columnTypes[matchedCol] === 'date' || /date/i.test(matchedCol)))) &&
      /standard|format|iso|yyyy|normaliz/i.test(lower)
    ) {
      const dateCol =
        matchedCol ||
        columns.find((c) => profile.columnTypes[c] === 'date' || /date/i.test(c));
      if (!dateCol) {
        const suspect = detectExplicitMissingColumn(clause, columns);
        return {
          status: 'invalid_column',
          explanation: suspect
            ? `Column '${suspect}' does not exist in this dataset.`
            : 'Could not identify which date column to standardize.',
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      operations.push({
        id: opId,
        type: 'standardize_date',
        params: { column: dateCol, format: 'iso_date' },
        description: `Standardize '${dateCol}' dates to YYYY-MM-DD`,
      });
      explanations.push(`standardized dates in '${dateCol}'`);
      continue;
    }

    // 7. Normalize categories (including Male/Female gender mapping)
    if (
      /normaliz|categor|\bgender\b/i.test(lower) ||
      (/standardiz/i.test(lower) && matchedCol && !/date|upper|lower|title/i.test(lower) && !/date/i.test(matchedCol))
    ) {
      const targetCatCol = matchedCol || columns.find((c) => /^(gender|sex|status|category)$/i.test(c));
      if (!targetCatCol) {
        const suspect = detectExplicitMissingColumn(clause, columns);
        return {
          status: suspect ? 'invalid_column' : 'needs_clarification',
          explanation: suspect
            ? `Column '${suspect}' does not exist in this dataset.`
            : 'Please name the categorical column you want normalized.',
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      const { mapping, caseType } = buildCategoryMappingFromSample(
        targetCatCol,
        profile.sampleRows || [],
        lower
      );
      operations.push({
        id: opId,
        type: 'normalize_categories',
        params: { column: targetCatCol, mapping, ...(caseType ? { caseType } : {}) },
        description: `Normalize category values in '${targetCatCol}'`,
      });
      explanations.push(`normalized categories in '${targetCatCol}'`);
      continue;
    }

    // 8. Outliers
    if (/outlier/i.test(lower)) {
      if (!matchedCol) {
        const suspect = detectExplicitMissingColumn(clause, columns);
        return {
          status: suspect ? 'invalid_column' : 'needs_clarification',
          explanation: suspect
            ? `Column '${suspect}' does not exist in this dataset.`
            : 'Please specify which numeric column to check for outliers.',
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      const useZ = /z-?score/i.test(lower);
      operations.push({
        id: opId,
        type: 'remove_outliers',
        params: { column: matchedCol, method: useZ ? 'zscore' : 'iqr' },
        description: `Remove numeric outliers in '${matchedCol}' (${useZ ? 'Z-score' : 'IQR'})`,
      });
      explanations.push(`removed outliers in '${matchedCol}'`);
      continue;
    }

    // 9. Explicit literal token replacement (e.g. "Replace all NA with 0", "Replace pending with active")
    const replaceTokenMatch = clause.match(
      /\breplace\s+(?:all\s+)?(?:values?\s+)?["']?([^"']+?)["']?\s+(?:values?\s+)?(?:with|to)\s+["']?([^"']+?)["']?$/i
    );
    if (
      replaceTokenMatch &&
      !/\bmissing\b|\bnull\b|\bempty\b|\bblank\b/i.test(replaceTokenMatch[1])
    ) {
      let findRaw = replaceTokenMatch[1].trim();
      const replRaw = replaceTokenMatch[2].trim().replace(/[.?!;]+$/, '').trim();
      let targetCol = matchedCol || 'ALL';
      if (matchedCol) {
        const stripped = findRaw
          .replace(new RegExp(`^(?:in|from)\\s+(?:the\\s+)?${matchedCol}\\s+`, 'i'), '')
          .replace(/\s+(?:in|from)\s+.*$/i, '')
          .trim();
        if (stripped) findRaw = stripped;
      }
      operations.push({
        id: opId,
        type: 'replace_values',
        params: {
          column: targetCol,
          findValue: findRaw,
          replaceValue: replRaw,
          exactMatch: true,
        },
        description: `Replace '${findRaw}' with '${replRaw}' in '${targetCol}'`,
      });
      explanations.push(`replaced '${findRaw}' with '${replRaw}' in '${targetCol}'`);
      continue;
    }

    // 10. Missing values ("Replace all missing values with 0.", "Fill missing age with mean", "Drop missing rows")
    if (/\bmissing\b|\bnull\b|\bempty\s+cells?\b|\bblank\s+cells?\b|\bfill\b/i.test(lower)) {
      let strategy: CleaningStrategy | null = null;
      let fillValue: string | undefined;

      if (/\b(drop|remove|delete)\b/i.test(lower)) {
        strategy = 'drop_row';
      } else if (/\b(mean|average|avg)\b/i.test(lower)) {
        strategy = 'fill_mean';
      } else if (/\bmedian\b/i.test(lower)) {
        strategy = 'fill_median';
      } else if (/\bmode\b/i.test(lower)) {
        strategy = 'fill_mode';
      } else if (/\b(prev|previous|forward)\b/i.test(lower)) {
        strategy = 'fill_prev';
      } else {
        const customMatch = clause.match(/\b(?:with|to)\s+["']?([^"']+?)["']?$/i);
        if (customMatch && customMatch[1] !== undefined) {
          const cleanedFill = customMatch[1].trim().replace(/[.?!;]+$/, '').trim();
          if (cleanedFill.length > 0) {
            strategy = 'fill_custom';
            fillValue = cleanedFill;
          }
        }
      }

      if (!strategy) {
        return {
          status: 'needs_clarification',
          explanation: 'Missing-value rule needs an explicit strategy.',
          clarificationQuestion:
            'How should missing values be handled? Specify drop rows, fill with mean/median/mode, previous value, or a custom value (e.g., "Replace all missing values with 0").',
          operations: [],
          executionMode: 'demo',
        };
      }

      const suspectMissing = matchedCols.length === 0 ? detectExplicitMissingColumn(clause, columns) : null;
      if (suspectMissing) {
        return {
          status: 'invalid_column',
          explanation: `Column '${suspectMissing}' was not found in the dataset.`,
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }

      const targetCols = matchedCols.length > 0 ? matchedCols : ['ALL'];
      operations.push({
        id: opId,
        type: 'handle_missing',
        params: {
          column: targetCols[0],
          ...(targetCols.length > 1 ? { columns: targetCols } : {}),
          strategy,
          ...(fillValue !== undefined ? { fillValue } : {}),
        },
        description: `Handle missing values in '${targetCols.join(', ')}' (${strategy}${
          fillValue !== undefined ? ` -> ${fillValue}` : ''
        })`,
      });
      explanations.push(`handled missing values in '${targetCols.join(', ')}'`);
      continue;
    }

    // 11. Text case conversion
    if (/(?:upper\s*case|lower\s*case|title\s*case)/i.test(lower)) {
      if (matchedCols.length === 0) {
        const suspect = detectExplicitMissingColumn(clause, columns);
        return {
          status: suspect ? 'invalid_column' : 'needs_clarification',
          explanation: suspect
            ? `Column '${suspect}' not found in dataset.`
            : 'Please name the text column to reformat.',
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      const caseType = /upper/i.test(lower)
        ? 'uppercase'
        : /title/i.test(lower)
        ? 'titlecase'
        : 'lowercase';
      operations.push({
        id: opId,
        type: 'standardize_text',
        params: { column: matchedCols[0], columns: matchedCols, caseType },
        description: `Convert '${matchedCols.join(', ')}' to ${caseType}`,
      });
      explanations.push(`standardized '${matchedCols.join(', ')}' to ${caseType}`);
      continue;
    }

    // 12. Remove one or multiple named columns ("Remove the email and phone columns")
    if (/\b(?:remove|drop|delete)\b/i.test(lower) && /\bcol(?:umn)?s?\b/i.test(lower)) {
      if (matchedCols.length === 0) {
        const suspect = detectExplicitMissingColumn(clause, columns);
        return {
          status: suspect ? 'invalid_column' : 'needs_clarification',
          explanation: suspect
            ? `Column '${suspect}' not found in dataset.`
            : 'Could not identify which column(s) to remove.',
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      operations.push({
        id: opId,
        type: 'remove_column',
        params:
          matchedCols.length > 1
            ? { columns: matchedCols }
            : { columnName: matchedCols[0] },
        description: `Remove column(s): ${matchedCols.join(', ')}`,
      });
      explanations.push(`removed column(s) ${matchedCols.join(', ')}`);
      continue;
    }

    // 13. Rename column
    const renameMatch = clause.match(
      /\brename\s+(?:column\s+)?["']?([a-zA-Z0-9_-]+)["']?\s+(?:to|as)\s+["']?([a-zA-Z0-9_-]+)["']?/i
    );
    if (renameMatch) {
      const oldResolved = findMatchedColumn(renameMatch[1], columns);
      if (!oldResolved) {
        return {
          status: 'invalid_column',
          explanation: `Column '${renameMatch[1]}' not found in dataset.`,
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      const safeNew = renameMatch[2].trim();
      operations.push({
        id: opId,
        type: 'rename_column',
        params: { oldName: oldResolved, newName: safeNew },
        description: `Rename '${oldResolved}' to '${safeNew}'`,
      });
      explanations.push(`renamed '${oldResolved}' to '${safeNew}'`);
      continue;
    }

    // 14. Sort rows
    if (/^\s*(?:sort|order)\s+(?:rows\s+|the\s+dataset\s+)?by\b/i.test(lower) || /\bsort\s+by\b/i.test(lower)) {
      if (!matchedCol) {
        const suspect = detectExplicitMissingColumn(clause, columns);
        return {
          status: suspect ? 'invalid_column' : 'needs_clarification',
          explanation: suspect
            ? `Column '${suspect}' not found in dataset.`
            : 'Please name the column to sort rows by.',
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      const direction: 'asc' | 'desc' = /\bdesc|descending|highest|largest\b/i.test(lower)
        ? 'desc'
        : 'asc';
      operations.push({
        id: opId,
        type: 'sort_rows',
        params: { column: matchedCol, direction },
        description: `Sort rows by '${matchedCol}' (${direction})`,
      });
      explanations.push(`sorted rows by '${matchedCol}' (${direction})`);
      continue;
    }

    // 15. Reorder columns
    if (/\breorder\s+col|move\s+col/i.test(lower) && matchedCols.length > 0) {
      operations.push({
        id: opId,
        type: 'reorder_columns',
        params: { order: matchedCols },
        description: `Reorder columns starting with ${matchedCols.join(', ')}`,
      });
      explanations.push(`reordered columns starting with ${matchedCols.join(', ')}`);
      continue;
    }

    // 16. Split column
    const splitMatch = clause.match(
      /\bsplit\s+(?:column\s+)?["']?([a-zA-Z0-9_-]+)["']?.*\binto\s+([a-zA-Z0-9_,\s]+)$/i
    );
    if (splitMatch) {
      const targetCol = findMatchedColumn(splitMatch[1], columns);
      if (!targetCol) {
        return {
          status: 'invalid_column',
          explanation: `Column '${splitMatch[1]}' was not found in the dataset.`,
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      const intoColumns = splitMatch[2]
        .split(/\s*(?:,|\band\b)\s*/i)
        .map((s) => s.trim())
        .filter(Boolean);
      const delimMatch = clause.match(/\bby\s+["']?([^"']+?)["']?\s+into/i);
      const delimiter =
        delimMatch && /space/i.test(delimMatch[1])
          ? ' '
          : delimMatch && /comma/i.test(delimMatch[1])
          ? ','
          : delimMatch
          ? delimMatch[1]
          : ' ';
      operations.push({
        id: opId,
        type: 'split_column',
        params: { column: targetCol, delimiter, intoColumns },
        description: `Split '${targetCol}' into ${intoColumns.join(', ')}`,
      });
      explanations.push(`split '${targetCol}'`);
      continue;
    }

    // 17. Merge columns
    const mergeMatch = clause.match(/\bmerge\s+(.+?)\s+into\s+["']?([a-zA-Z0-9_-]+)["']?$/i);
    if (mergeMatch && matchedCols.length >= 2) {
      const targetCol = mergeMatch[2].trim();
      const dropOriginals = /\bdrop\b|\bremove\b/i.test(lower);
      operations.push({
        id: opId,
        type: 'merge_columns',
        params: {
          columns: matchedCols,
          separator: ' ',
          targetColumn: targetCol,
          dropOriginals,
        },
        description: `Merge [${matchedCols.join(', ')}] into '${targetCol}'`,
      });
      explanations.push(`merged columns into '${targetCol}'`);
      continue;
    }

    // 18. Convert type
    const convertMatch = clause.match(/\bto\s+(number|numeric|int|float|date|string|text|boolean)\b/i);
    if (/convert|cast|parse/i.test(lower) && convertMatch) {
      if (!matchedCol) {
        const suspect = detectExplicitMissingColumn(clause, columns);
        return {
          status: suspect ? 'invalid_column' : 'needs_clarification',
          explanation: suspect
            ? `Column '${suspect}' not found in dataset.`
            : 'Please specify the column whose data type you want to convert.',
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }
      const rawT = convertMatch[1].toLowerCase();
      const targetType: 'number' | 'date' | 'string' | 'boolean' =
        rawT === 'numeric' || rawT === 'int' || rawT === 'float' || rawT === 'number'
          ? 'number'
          : rawT === 'text' || rawT === 'string'
          ? 'string'
          : (rawT as 'date' | 'boolean');
      operations.push({
        id: opId,
        type: 'convert_type',
        params: { column: matchedCol, targetType },
        description: `Convert '${matchedCol}' to ${targetType}`,
      });
      explanations.push(`converted '${matchedCol}' to ${targetType}`);
      continue;
    }

    // 19. Row filtering (supports BOTH "keep/filter rows where ..." AND "remove/drop rows where ...")
    const filterSymMatch = clause.match(
      /(keep|filter|only|remove|drop|delete)(?:\s+rows)?(?:\s+where)?\s+["']?([a-zA-Z0-9_-]+)["']?\s*(>=|<=|!=|==|=|>|<|below|under|less\s+than|above|over|greater\s+than|at\s+least|at\s+most|equals|contains)\s*["']?([^"']+?)["']?$/i
    );
    if (filterSymMatch) {
      const verb = filterSymMatch[1].toLowerCase();
      const isRemoveIntent = verb === 'remove' || verb === 'drop' || verb === 'delete';
      const targetCol = findMatchedColumn(filterSymMatch[2], columns);
      if (!targetCol) {
        return {
          status: 'invalid_column',
          explanation: `Column '${filterSymMatch[2]}' was not found in the dataset.`,
          clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
          operations: [],
          executionMode: 'demo',
        };
      }

      const rawOp = filterSymMatch[3].toLowerCase().replace(/\s+/g, ' ');
      const keepOperatorMap: Record<string, FilterOperator> = {
        '=': 'equals',
        '==': 'equals',
        equals: 'equals',
        '!=': 'not_equals',
        contains: 'contains',
        '>': 'greater_than',
        above: 'greater_than',
        over: 'greater_than',
        'greater than': 'greater_than',
        '<': 'less_than',
        below: 'less_than',
        under: 'less_than',
        'less than': 'less_than',
        '>=': 'greater_or_equal',
        'at least': 'greater_or_equal',
        '<=': 'less_or_equal',
        'at most': 'less_or_equal',
      };
      const inverseOperatorMap: Record<FilterOperator, FilterOperator> = {
        equals: 'not_equals',
        not_equals: 'equals',
        contains: 'not_contains',
        not_contains: 'contains',
        greater_than: 'less_or_equal',
        less_or_equal: 'greater_than',
        less_than: 'greater_or_equal',
        greater_or_equal: 'less_than',
        not_empty: 'is_empty',
        is_empty: 'not_empty',
      };

      const matchedKeepOp = keepOperatorMap[rawOp] || 'equals';
      const effectiveOp = isRemoveIntent ? inverseOperatorMap[matchedKeepOp] : matchedKeepOp;
      const val = filterSymMatch[4].trim();

      operations.push({
        id: opId,
        type: 'filter_rows',
        params: { column: targetCol, operator: effectiveOp, value: val },
        description: `${isRemoveIntent ? 'Remove matching' : 'Keep matching'} rows: ${targetCol} ${effectiveOp} '${val}'`,
      });
      explanations.push(`filtered '${targetCol}' (${effectiveOp} ${val})`);
      continue;
    }

    // Check if unrecognized clause references a non-existent column
    const missingFromClause = detectExplicitMissingColumn(clause, columns);
    if (missingFromClause) {
      return {
        status: 'invalid_column',
        explanation: `Column '${missingFromClause}' not found in dataset.`,
        clarificationQuestion: `Available columns are: ${columns.join(', ')}.`,
        operations: [],
        executionMode: 'demo',
      };
    }
  }

  if (operations.length === 0) {
    return {
      status: 'needs_clarification',
      explanation:
        'Demo Mode deterministic parser did not match an explicit supported rule from your instruction.',
      clarificationQuestion: `Try phrases like "Replace all missing values with 0", "Remove duplicate rows", "Trim whitespace", "Standardize gender values into Male and Female", or "Remove rows where salary < 20000" across columns: ${columns.join(', ')}.`,
      operations: [],
      executionMode: 'demo',
    };
  }

  return {
    status: 'ready',
    explanation: `Demo Mode · Deterministic Local Interpreter (no Gemini API call): ${explanations.join(', ')}.`,
    operations,
    executionMode: 'demo',
  };
}
