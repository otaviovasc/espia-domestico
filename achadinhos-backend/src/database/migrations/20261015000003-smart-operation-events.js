'use strict'

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE smart_operation_events (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action VARCHAR(80) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX smart_operation_events_owner_time ON smart_operation_events(user_id, occurred_at);
    `)
  },
  async down(queryInterface) {
    await queryInterface.dropTable('smart_operation_events')
  },
}
