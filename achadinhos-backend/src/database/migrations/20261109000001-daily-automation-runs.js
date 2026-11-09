'use strict'

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE daily_automation_runs (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        local_date DATE NOT NULL,
        request_id UUID NOT NULL UNIQUE,
        config JSONB NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'COLLECTING',
        payloads JSONB,
        plan_uuid UUID REFERENCES smart_plans(uuid),
        attempts INTEGER NOT NULL DEFAULT 0,
        lease_token UUID,
        lease_until TIMESTAMPTZ,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_error VARCHAR(80),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, local_date)
      );
    `)
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE daily_automation_runs')
  },
}
