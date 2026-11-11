'use strict'

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE daily_automation_runs
      ADD COLUMN approval_attempts INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN approval_revision INTEGER`)
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE daily_automation_runs DROP COLUMN approval_revision, DROP COLUMN approval_attempts')
  },
}
