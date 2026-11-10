'use strict'
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`ALTER TABLE daily_automation_alerts DROP CONSTRAINT daily_automation_alerts_status_check;
    ALTER TABLE daily_automation_alerts ADD CONSTRAINT daily_automation_alerts_status_check CHECK(status IN('PENDING','SENDING','SENT','UNKNOWN','EXPIRED'));
    CREATE TABLE ml_auth_challenges (
      id UUID PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_scope TEXT NOT NULL, group_id TEXT NOT NULL, owner_id UUID NOT NULL,
      status TEXT NOT NULL CHECK(status IN('WAITING','CODE_READY','SUBMITTING','SUCCEEDED','FAILED','EXPIRED')),
      code_ciphertext TEXT, accepted_message_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX ml_auth_one_active ON ml_auth_challenges(user_id) WHERE status IN('WAITING','CODE_READY','SUBMITTING');
    CREATE INDEX ml_auth_scope_group ON ml_auth_challenges(connection_scope,group_id,created_at DESC);
    CREATE UNIQUE INDEX ml_auth_code_message_once ON ml_auth_challenges(connection_scope,accepted_message_id) WHERE accepted_message_id IS NOT NULL;
    CREATE INDEX ml_auth_expiry ON ml_auth_challenges(expires_at) WHERE status IN('WAITING','CODE_READY','SUBMITTING');`, { transaction })
    })
  },
  async down(queryInterface) { await queryInterface.sequelize.query("DROP TABLE ml_auth_challenges; UPDATE daily_automation_alerts SET status='UNKNOWN' WHERE status='EXPIRED'; ALTER TABLE daily_automation_alerts DROP CONSTRAINT daily_automation_alerts_status_check; ALTER TABLE daily_automation_alerts ADD CONSTRAINT daily_automation_alerts_status_check CHECK(status IN('PENDING','SENDING','SENT','UNKNOWN'))") },
}
