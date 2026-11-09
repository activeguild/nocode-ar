// マイグレーション SQL の埋め込み。server/migrations/*.sql と同一内容を保つ（test/migrations.test.ts で検証）。
// 関数バンドルがファイルシステムに依存しないようにするため（M-R3-03）。
export interface Migration {
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    name: '001_init.sql',
    sql: `-- 初期スキーマ（PostgreSQL / PGlite 共通）。日時は ISO 8601 文字列（TEXT）で保持する。
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  preview_token TEXT NOT NULL UNIQUE,
  draft_scene TEXT NOT NULL,
  published_scene_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage TEXT NOT NULL,          -- 'local' | 'blob' | 'memory'
  storage_key TEXT NOT NULL,      -- local: 相対パス, blob: pathname
  url TEXT NOT NULL,              -- 配信 URL（local: /a/<id>.<ext>, blob: 絶対 URL）
  width INTEGER,
  height INTEGER,
  duration_sec DOUBLE PRECISION,
  sha256 TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);

CREATE TABLE IF NOT EXISTS scene_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene TEXT NOT NULL,
  published_at TEXT NOT NULL,
  published_by_user_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scene_versions_project ON scene_versions(project_id, published_at);

CREATE TABLE IF NOT EXISTS publish_events (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  scene_version_id TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publish_events_project ON publish_events(project_id, at);

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_version_id TEXT,
  type TEXT NOT NULL,
  button_id TEXT,
  os TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  day_jst TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_project_day ON analytics_events(project_id, day_jst);

-- サーバレスではプロセス内メモリに状態を持てないため、ログインロックとレート制限も DB に置く
CREATE TABLE IF NOT EXISTS login_locks (
  email TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  last_attempt BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count INTEGER NOT NULL
);
`,
  },
]
