'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Add the new enum value if it does not already exist (Postgres).
    await queryInterface.sequelize.query(
      "ALTER TYPE \"enum_campaigns_status\" ADD VALUE IF NOT EXISTS 'PAUSED';",
    )
  },

  async down() {
    // Postgres cannot easily remove an enum value; no-op on down.
  },
}
