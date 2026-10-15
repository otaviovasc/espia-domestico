'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'smart_ai_requests',
        {
          id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
          user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
          },
          request_key: { type: DataTypes.STRING(64), allowNull: false },
          cache_key: { type: DataTypes.STRING(64), allowNull: false },
          operation: { type: DataTypes.STRING(64), allowNull: false },
          operation_id: { type: DataTypes.STRING(120), allowNull: true },
          model: { type: DataTypes.STRING(160), allowNull: false },
          model_version: { type: DataTypes.STRING(80), allowNull: false },
          status: {
            type: DataTypes.ENUM('RESERVED', 'SUCCEEDED', 'FAILED_UNKNOWN'),
            allowNull: false,
            defaultValue: 'RESERVED',
          },
          quota_date: { type: DataTypes.DATEONLY, allowNull: false },
          reserved_input_tokens: { type: DataTypes.INTEGER, allowNull: false },
          reserved_output_tokens: { type: DataTypes.INTEGER, allowNull: false },
          reserved_cost_micros: { type: DataTypes.BIGINT, allowNull: false },
          actual_input_tokens: { type: DataTypes.INTEGER, allowNull: true },
          actual_output_tokens: { type: DataTypes.INTEGER, allowNull: true },
          accounted_cost_micros: { type: DataTypes.BIGINT, allowNull: true },
          response_payload: { type: DataTypes.JSONB, allowNull: true },
          cache_expires_at: { type: DataTypes.DATE, allowNull: false },
          completed_at: { type: DataTypes.DATE, allowNull: true },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction },
      )
      await queryInterface.addIndex('smart_ai_requests', ['user_id', 'request_key'], {
        name: 'smart_ai_requests_user_request_unique',
        unique: true,
        transaction,
      })
      await queryInterface.addIndex(
        'smart_ai_requests',
        ['user_id', 'cache_key', 'status', 'cache_expires_at'],
        { name: 'smart_ai_requests_tenant_cache_idx', transaction },
      )
      await queryInterface.addIndex('smart_ai_requests', ['user_id', 'quota_date'], {
        name: 'smart_ai_requests_tenant_daily_budget_idx',
        transaction,
      })
      await queryInterface.addIndex('smart_ai_requests', ['quota_date'], {
        name: 'smart_ai_requests_global_daily_budget_idx',
        transaction,
      })
    })
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('smart_ai_requests', { transaction })
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_smart_ai_requests_status";', {
        transaction,
      })
    })
  },
}
