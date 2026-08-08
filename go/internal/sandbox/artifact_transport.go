package sandbox

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ArtifactTransport provides SHA-256 digest-verified workspace artifact
// import/export between a host worktree and a container filesystem.
type ArtifactTransport struct {
	client    *AgentENVClient
	sandboxID string
}

// NewArtifactTransport creates a transport bound to a sandbox.
func NewArtifactTransport(client *AgentENVClient, sandboxID string) *ArtifactTransport {
	return &ArtifactTransport{client: client, sandboxID: sandboxID}
}

// ImportFile copies a single file from the host worktree into the container,
// computing and verifying a SHA-256 digest. The hostPath must be inside
// worktreeRoot (path-jail enforcement).
func (at *ArtifactTransport) ImportFile(ctx context.Context, worktreeRoot, hostPath, containerPath string) error {
	if err := validatePathJail(worktreeRoot, hostPath); err != nil {
		return fmt.Errorf("import path jail: %w", err)
	}

	digest, err := hashFileOnDisk(hostPath)
	if err != nil {
		return fmt.Errorf("hash host file: %w", err)
	}

	return at.client.ImportArtifact(ctx, ImportArtifactRequest{
		SandboxID:     at.sandboxID,
		HostPath:      hostPath,
		ContainerPath: containerPath,
		SHA256Digest:  digest,
	})
}

// ExportFile copies a single file from the container filesystem to the host
// worktree and verifies the SHA-256 digest returned by the API matches the
// file on disk after writing. The hostPath must be inside worktreeRoot.
func (at *ArtifactTransport) ExportFile(ctx context.Context, worktreeRoot, containerPath, hostPath string) (string, error) {
	if err := validatePathJail(worktreeRoot, hostPath); err != nil {
		return "", fmt.Errorf("export path jail: %w", err)
	}

	// Ensure destination directory exists.
	if err := os.MkdirAll(filepath.Dir(hostPath), 0o755); err != nil {
		return "", fmt.Errorf("mkdir for export: %w", err)
	}

	resp, err := at.client.ExportArtifact(ctx, ExportArtifactRequest{
		SandboxID:     at.sandboxID,
		ContainerPath: containerPath,
		HostPath:      hostPath,
	})
	if err != nil {
		return "", fmt.Errorf("export artifact api: %w", err)
	}

	// Verify the exported file digest matches the API response.
	actualDigest, err := hashFileOnDisk(hostPath)
	if err != nil {
		return "", fmt.Errorf("hash exported file: %w", err)
	}
	if !strings.EqualFold(actualDigest, resp.SHA256Digest) {
		// Digest mismatch -- remove the corrupted file.
		_ = os.Remove(hostPath)
		return "", fmt.Errorf(
			"digest mismatch after export: expected %s, got %s",
			resp.SHA256Digest, actualDigest,
		)
	}

	return resp.SHA256Digest, nil
}

// ImportDirectory recursively imports all files under hostDir into the
// container at containerDir, preserving relative paths.
func (at *ArtifactTransport) ImportDirectory(ctx context.Context, worktreeRoot, hostDir, containerDir string) (int, error) {
	if err := validatePathJail(worktreeRoot, hostDir); err != nil {
		return 0, fmt.Errorf("import dir path jail: %w", err)
	}

	count := 0
	err := filepath.Walk(hostDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(hostDir, path)
		if relErr != nil {
			return relErr
		}
		containerPath := filepath.Join(containerDir, filepath.ToSlash(rel))
		if importErr := at.ImportFile(ctx, worktreeRoot, path, containerPath); importErr != nil {
			return importErr
		}
		count++
		return nil
	})
	return count, err
}

// ---------- helpers ----------

// hashFileOnDisk computes the SHA-256 hex digest of a file.
func hashFileOnDisk(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// validatePathJail verifies that target is inside root, preventing directory
// traversal attacks. Uses filepath.Abs + filepath.EvalSymlinks for
// defense-in-depth.
func validatePathJail(root, target string) error {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolve root: %w", err)
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return fmt.Errorf("resolve target: %w", err)
	}

	// Evaluate symlinks when the paths exist on disk.
	if realRoot, e := filepath.EvalSymlinks(absRoot); e == nil {
		absRoot = realRoot
	}
	if realTarget, e := filepath.EvalSymlinks(absTarget); e == nil {
		absTarget = realTarget
	}

	// Normalize with trailing separator so /workspace doesn't match
	// /workspace-other.
	prefix := absRoot + string(filepath.Separator)
	if absTarget != absRoot && !strings.HasPrefix(absTarget, prefix) {
		return fmt.Errorf("path %q escapes worktree root %q", target, root)
	}
	return nil
}
