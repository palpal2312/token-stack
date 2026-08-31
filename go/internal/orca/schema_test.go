package orca

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSchemaSQLMatchesMigrationFile(t *testing.T) {
	// migrations/000004 comment header is stripped; body must match schemaSQL.
	root := filepath.Join("..", "..", "migrations", "000004_orca_dispatch_cursors.sql")
	raw, err := os.ReadFile(root)
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	body = strings.ReplaceAll(body, "\r\n", "\n")
	// Drop leading SQL comment lines.
	for {
		if strings.HasPrefix(body, "--") {
			if i := strings.IndexByte(body, '\n'); i >= 0 {
				body = body[i+1:]
				continue
			}
		}
		break
	}
	body = strings.TrimSpace(body)
	want := strings.TrimSpace(schemaSQL)
	if body != want {
		t.Fatalf("migration body diverges from embedded schemaSQL\nlen(file)=%d len(embed)=%d", len(body), len(want))
	}
}
