-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "cwd" TEXT NOT NULL DEFAULT '',
    "command" TEXT NOT NULL DEFAULT '',
    "jsonl_session_id" TEXT NOT NULL DEFAULT '',
    "jsonl_session_pinned" BOOLEAN NOT NULL DEFAULT false,
    "repo_url" TEXT NOT NULL DEFAULT '',
    "repo_token" TEXT NOT NULL DEFAULT '',
    "agent" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosts" (
    "id" SERIAL NOT NULL,
    "project_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ssh_target" TEXT NOT NULL,
    "machine_id" INTEGER,
    "path" TEXT NOT NULL DEFAULT '',
    "deploy_type" TEXT NOT NULL DEFAULT 'ssh',
    "env" TEXT NOT NULL DEFAULT 'production',
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machines" (
    "id" SERIAL NOT NULL,
    "hostname" TEXT NOT NULL,
    "display_name" TEXT NOT NULL DEFAULT '',
    "dns_name" TEXT NOT NULL DEFAULT '',
    "tailscale_ip" TEXT NOT NULL DEFAULT '',
    "os" TEXT NOT NULL DEFAULT '',
    "ssh_user" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "online" BOOLEAN NOT NULL DEFAULT false,
    "is_self" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'tailscale',
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" SERIAL NOT NULL,
    "session_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "issue_id" INTEGER,
    "pr_url" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_exchanges" (
    "id" SERIAL NOT NULL,
    "note_id" INTEGER NOT NULL,
    "session_id" TEXT NOT NULL,
    "prompt_uuid" TEXT NOT NULL,
    "asked_at" TIMESTAMP(3) NOT NULL,
    "prompt" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" SERIAL NOT NULL,
    "project_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "source_ref" TEXT NOT NULL DEFAULT '',
    "assigned_to" TEXT NOT NULL DEFAULT '',
    "session_name" TEXT NOT NULL DEFAULT '',
    "resolution_type" TEXT NOT NULL DEFAULT '',
    "resolution_ref" TEXT NOT NULL DEFAULT '',
    "resolution_note" TEXT NOT NULL DEFAULT '',
    "resolved_by" TEXT NOT NULL DEFAULT '',
    "resolved_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_runs" (
    "id" SERIAL NOT NULL,
    "project_name" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "tool_version" TEXT NOT NULL DEFAULT '',
    "ruleset_ref" TEXT NOT NULL DEFAULT '',
    "commit_sha" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error_message" TEXT NOT NULL DEFAULT '',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "sarif_path" TEXT NOT NULL DEFAULT '',
    "summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "scan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_findings" (
    "id" SERIAL NOT NULL,
    "scan_run_id" INTEGER NOT NULL,
    "project_name" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "cwe" TEXT NOT NULL DEFAULT '',
    "owasp" TEXT NOT NULL DEFAULT '',
    "cvss" DOUBLE PRECISION,
    "file_path" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "end_line" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT '',
    "fingerprint" TEXT NOT NULL,
    "fixed" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issue_id" INTEGER,

    CONSTRAINT "scan_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_events" (
    "id" SERIAL NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_value" TEXT NOT NULL DEFAULT '',
    "to_value" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_key" ON "projects"("name");

-- CreateIndex
CREATE UNIQUE INDEX "machines_hostname_key" ON "machines"("hostname");

-- CreateIndex
CREATE INDEX "notes_issue_id_idx" ON "notes"("issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "note_exchanges_prompt_uuid_key" ON "note_exchanges"("prompt_uuid");

-- CreateIndex
CREATE INDEX "note_exchanges_note_id_idx" ON "note_exchanges"("note_id");

-- CreateIndex
CREATE INDEX "issues_project_name_idx" ON "issues"("project_name");

-- CreateIndex
CREATE INDEX "issues_status_idx" ON "issues"("status");

-- CreateIndex
CREATE INDEX "scan_runs_project_name_idx" ON "scan_runs"("project_name");

-- CreateIndex
CREATE INDEX "scan_runs_started_at_idx" ON "scan_runs"("started_at");

-- CreateIndex
CREATE INDEX "scan_findings_project_name_idx" ON "scan_findings"("project_name");

-- CreateIndex
CREATE INDEX "scan_findings_fingerprint_idx" ON "scan_findings"("fingerprint");

-- CreateIndex
CREATE INDEX "scan_findings_severity_idx" ON "scan_findings"("severity");

-- CreateIndex
CREATE INDEX "issue_events_issue_id_idx" ON "issue_events"("issue_id");

-- AddForeignKey
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_project_name_fkey" FOREIGN KEY ("project_name") REFERENCES "projects"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_session_name_fkey" FOREIGN KEY ("session_name") REFERENCES "projects"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_exchanges" ADD CONSTRAINT "note_exchanges_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_name_fkey" FOREIGN KEY ("project_name") REFERENCES "projects"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_project_name_fkey" FOREIGN KEY ("project_name") REFERENCES "projects"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_findings" ADD CONSTRAINT "scan_findings_scan_run_id_fkey" FOREIGN KEY ("scan_run_id") REFERENCES "scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

