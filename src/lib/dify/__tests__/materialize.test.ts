import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "crypto";
import { materializeOutput } from "../materialize";

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    default: {
      ...actual,
      readFile: vi.fn(),
      access: vi.fn(),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn(),
    },
    readFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
  };
});

vi.mock("../../llmops/ledger", () => {
  const RunLedger = vi.fn();
  RunLedger.prototype.getRun = vi.fn().mockResolvedValue({
    runId: "test-run",
    artifacts: []
  });
  RunLedger.prototype.append = vi.fn().mockResolvedValue({});
  return { RunLedger };
});

describe("materializeOutput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should materialize a valid artifact", async () => {
    const mockManifest = {
      runId: "test-run",
      artifacts: [
        {
          key: "test_output",
          type: "text",
          sizeBytes: 12,
          omitted: false,
          redactionClass: "public"
        }
      ],
      spooledAt: "2023-01-01T00:00:00Z"
    };

    const mockReadFile = vi.fn().mockImplementation(async (filePath: any) => {
      const pathStr = String(filePath);
      if (pathStr.endsWith("manifest.json")) {
        return JSON.stringify(mockManifest);
      }
      if (pathStr.endsWith(".dat")) {
        return Buffer.from("test content");
      }
      throw new Error(`Unexpected readFile: ${pathStr}`);
    });

    vi.mocked(fs.readFile).mockImplementation(mockReadFile);
    // @ts-ignore
    fs.default.readFile = mockReadFile;

    const mockAccess = vi.fn().mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fs.access).mockImplementation(mockAccess);
    // @ts-ignore
    fs.default.access = mockAccess;

    const mockMkdir = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockImplementation(mockMkdir);
    // @ts-ignore
    fs.default.mkdir = mockMkdir;

    const mockWriteFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockImplementation(mockWriteFile);
    // @ts-ignore
    fs.default.writeFile = mockWriteFile;

    const mockRename = vi.fn().mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockImplementation(mockRename);
    // @ts-ignore
    fs.default.rename = mockRename;

    const artifact = await materializeOutput("test-run", "test_output");
    
    expect(artifact.id).toMatch(/^dify-art-[a-f0-9]{16}$/);
    expect(artifact.kind).toBe("text");
    expect(artifact.uri).toMatch(/test_output-[a-f0-9]{8}\.txt$/);
    expect(artifact.redactionClass).toBe("public");
    expect(mockWriteFile).toHaveBeenCalled();
    expect(mockRename).toHaveBeenCalled();
  });

  it("should throw error if output omitted", async () => {
    const mockManifest = {
      runId: "test-run",
      artifacts: [
        {
          key: "test_output",
          type: "text",
          sizeBytes: 12,
          omitted: true,
          redactionClass: "public"
        }
      ],
      spooledAt: "2023-01-01T00:00:00Z"
    };

    const mockReadFile = vi.fn().mockImplementation(async (filePath: any) => {
      const pathStr = String(filePath);
      if (pathStr.endsWith("manifest.json")) {
        return JSON.stringify(mockManifest);
      }
      throw new Error(`Unexpected readFile: ${pathStr}`);
    });

    vi.mocked(fs.readFile).mockImplementation(mockReadFile);
    // @ts-ignore
    fs.default.readFile = mockReadFile;

    await expect(materializeOutput("test-run", "test_output")).rejects.toThrow(/omitted due to size limits/);
  });
});
