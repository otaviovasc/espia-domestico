'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX smart_plans_user_request_id_unique
        ON smart_plans (user_id, ((input->>'requestId')))
       WHERE input ? 'requestId'
         AND NULLIF(input->>'requestId', '') IS NOT NULL;
    `)
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS smart_plans_user_request_id_unique')
  },
}
