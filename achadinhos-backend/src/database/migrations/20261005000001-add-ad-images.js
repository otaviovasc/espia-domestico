'use strict'

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TYPE "enum_ad_assets_kind" ADD VALUE IF NOT EXISTS \'image\'',
    )
  },

  async down() {
    // PostgreSQL cannot remove an enum value without rebuilding the type and
    // deleting or converting existing image assets.
    throw new Error('Remova os projetos com imagens antes de planejar o rollback desta migração')
  },
}
