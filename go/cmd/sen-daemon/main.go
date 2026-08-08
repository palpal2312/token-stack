package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"agentos.local/newsos/internal/builderexec"
	"agentos.local/newsos/internal/config"
	"agentos.local/newsos/internal/database"
	"agentos.local/newsos/internal/events"
	"agentos.local/newsos/internal/herdradapter"
	"agentos.local/newsos/internal/projections"
	"agentos.local/newsos/internal/projections/kanban"
	runtimeprojection "agentos.local/newsos/internal/projections/runtime"
	"agentos.local/newsos/internal/runtime/windows"
)

const version = "phase-09-postgresql-event-spine"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.LoadConfig()
	if err != nil {
		logger.Error("config_invalid", "error", err)
		os.Exit(1)
	}
	plan := windows.DefaultBootstrapPlan()
	if err := windows.ValidateBootstrapPlan(plan); err != nil {
		logger.Error("windows_bootstrap_contract_invalid", "error", err)
		os.Exit(1)
	}
	logger.Info("daemon_bootstrap_ready", "version", version, "config", cfg.Redacted(), "postgres", plan.PostgresDistribution, "supervisor", plan.Supervisor)

	// Open PostgreSQL connection with validation
	db, err := database.OpenPostgres(cfg.PostgresDSN, cfg.DBTimeout)
	if err != nil {
		logger.Error("database_connection_failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Verify migrations applied (including 000008 runtime event taxonomy)
	migrationCtx, migrationCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := database.CheckMigrations(migrationCtx, db); err != nil {
		migrationCancel()
		logger.Error("database_migrations_check_failed", "error", err)
		os.Exit(1)
	}
	migrationCancel()
	logger.Info("database_ready", "migrations", "verified")

	// Use PostgreSQL appender for durable event persistence
	appender, err := events.NewPostgresAppender(db)
	if err != nil {
		logger.Error("postgres_appender_init_failed", "error", err)
		os.Exit(1)
	}
	leaseAuth := herdradapter.NewInMemoryLeaseAuthorizer()
	eventStore := builderexec.NewRuntimeEventStore(appender, leaseAuth)
	runtimeProjector := runtimeprojection.NewProjector()
	checkpointStore, err := projections.NewPostgresCheckpointStore(db)
	if err != nil {
		logger.Error("postgres_checkpoint_store_init_failed", "error", err)
		os.Exit(1)
	}
	if err := checkpointStore.EnsureTable(context.Background()); err != nil {
		logger.Error("checkpoint_table_init_failed", "error", err)
		os.Exit(1)
	}
	logger.Info("checkpoint_store_ready", "backend", "postgresql")
	runtimeConsumer := runtimeprojection.NewConsumer(appender, checkpointStore, runtimeProjector)
	kanbanProjector := kanban.NewProjector()

	herdrBin := os.Getenv("HERDR_BIN")
	if herdrBin == "" {
		herdrBin = "herdr"
	}
	adapter := herdradapter.NewHerdrCLIAdapter(leaseAuth, herdrBin)
	builderSvc := &builderexec.Service{
		Adapter:       adapter,
		RuntimeEvents: eventStore,
	}
	poller := builderexec.NewRuntimePoller(adapter, builderSvc, logger)

	httpAddr := os.Getenv("SEN_DAEMON_ADDR")
	if httpAddr == "" {
		httpAddr = "127.0.0.1:3738"
	}
	server := &HTTPServer{
		Addr:              httpAddr,
		Logger:            logger,
		BuilderExec:       builderSvc,
		LeaseAuth:         leaseAuth,
		RuntimePoller:     poller,
		RuntimeProjection: runtimeProjector,
		KanbanProjection:  kanbanProjector,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		if err := runtimeConsumer.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("runtime_projection_failed", "error", err)
			cancel()
		}
	}()
	go func() {
		if err := poller.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("runtime_poller_failed", "error", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		logger.Info("shutdown_signal_received")
		poller.Stop()
		cancel()
	}()

	if err := server.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
		logger.Error("http_server_failed", "error", err)
		os.Exit(1)
	}
	logger.Info("daemon_shutdown_complete")
}
