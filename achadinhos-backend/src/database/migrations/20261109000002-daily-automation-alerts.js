'use strict'
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE daily_automation_runs ADD COLUMN IF NOT EXISTS discovery_state JSONB NOT NULL DEFAULT '{}';
      CREATE TABLE IF NOT EXISTS daily_automation_alerts (
      id UUID PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_key VARCHAR(200) NOT NULL, group_id VARCHAR(120) NOT NULL, body TEXT NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','UNKNOWN')),
      preflight_attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), provider_message_id VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,event_key));
      CREATE INDEX IF NOT EXISTS daily_automation_alerts_pending ON daily_automation_alerts(user_id,next_attempt_at) WHERE status='PENDING';`)
  },
  async down(queryInterface) { await queryInterface.sequelize.query('DROP TABLE daily_automation_alerts; ALTER TABLE daily_automation_runs DROP COLUMN discovery_state') },
}
