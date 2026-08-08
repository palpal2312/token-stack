package sandbox

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestValidatePathJailAllowsInsidePath(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "subdir", "file.txt")
	if err := validatePathJail(root, target); err != nil {
		t.Errorf("expected path inside root to be allowed: %v", err)
	}
}

func TestValidatePathJailBlocksEscape(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "..", "outside.txt")
	if err := validatePathJail(root, target); err == nil {
		t.Error("expected path escape to be rejected")
	}
}

func TestValidatePathJailAllowsRootItself(t *testing.T) {
	root := t.TempDir()
	if err := validatePathJail(root, root); err != nil {
		t.Errorf("root path itself should be allowed: %v", err)
	}
}

func TestValidatePathJailBlocksSiblingPrefix(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "workspace")
	os.MkdirAll(root, 0o755)
	sibling := filepath.Join(parent, "workspace-other", "file.txt")
	if err := validatePathJail(root, sibling); err == nil {
		t.Error("expected sibling with shared prefix to be rejected")
	}
}

func TestHashFileOnDisk(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.txt")
	content := []byte("hello world")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := hashFileOnDisk(path)
	if err != nil {
		t.Fatal(err)
	}

	h := sha256.Sum256(content)
	want := hex.EncodeToString(h[:])
	if got != want {
		t.Errorf("hash = %s, want %s", got, want)
	}
}

func TestHashFileOnDiskNotFound(t *testing.T) {
	_, err := hashFileOnDisk(filepath.Join(t.TempDir(), "nonexistent.txt"))
	if err == nil {
		t.Error("expected error for missing file")
	}
}

func TestArtifactTransportImportPathJailViolation(t *testing.T) {
	// ImportFile should reject paths outside the worktree root.
	client := NewAgentENVClient("http://unused")
	transport := NewArtifactTransport(client, "sbx-test")

	root := t.TempDir()
	hostPath := filepath.Join(root, "..", "escape.txt")

	err := transport.ImportFile(context.Background(), root, hostPath, "/container/escape.txt")
	if err == nil {
		t.Error("expected path jail error for import")
	}
}

func TestArtifactTransportExportPathJailViolation(t *testing.T) {
	client := NewAgentENVClient("http://unused")
	transport := NewArtifactTransport(client, "sbx-test")

	root := t.TempDir()
	hostPath := filepath.Join(root, "..", "escape.txt")

	_, err := transport.ExportFile(context.Background(), root, "/container/file.txt", hostPath)
	if err == nil {
		t.Error("expected path jail error for export")
	}
}
