'use strict'
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`CREATE TABLE affiliate_sales_notice_cursors (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      observed_at TIMESTAMPTZ NOT NULL, generation_id UUID NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  },
  async down(queryInterface) { await queryInterface.sequelize.query('DROP TABLE affiliate_sales_notice_cursors') },
}
