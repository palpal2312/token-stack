// newsos-backup is a local-only wrapper around the existing product snapshot contract.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"agentic-os/internal/localdb/product"
)

func run(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: newsos-backup <backup|restore> [flags]")
	}
	operation := args[0]
	if operation != "backup" && operation != "restore" {
		return fmt.Errorf("unknown operation: %s", operation)
	}
	flags := flag.NewFlagSet(operation, flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	storeRoot := flags.String("store-root", "", "product store root")
	backupFile := flags.String("backup-file", "", "snapshot file")
	restoreRoot := flags.String("restore-root", "", "fresh restore root")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	if *storeRoot == "" || *backupFile == "" {
		return fmt.Errorf("store-root and backup-file are required")
	}
	ctx := context.Background()
	switch operation {
	case "backup":
		db, err := product.Open(ctx, *storeRoot)
		if err != nil {
			return err
		}
		defer db.Close()
		if err := product.Backup(ctx, db, *backupFile); err != nil {
			return err
		}
		fmt.Println("newsos-backup-ok operation=backup")
		return nil
	case "restore":
		if *restoreRoot == "" {
			return fmt.Errorf("restore-root is required")
		}
		db, err := product.Restore(ctx, *backupFile, *restoreRoot)
		if err != nil {
			return err
		}
		defer db.Close()
		fmt.Println("newsos-backup-ok operation=restore")
		return nil
	}
	return fmt.Errorf("unsupported operation")
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "newsos-backup-failed")
		os.Exit(1)
	}
}
