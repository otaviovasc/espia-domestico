'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize

    // ── users ──────────────────────────────────────
    await queryInterface.createTable('users', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.UUID, allowNull: false, unique: true },
      name: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING, allowNull: false },
      role: {
        type: DataTypes.ENUM('ADMIN', 'MEMBER'),
        allowNull: false,
        defaultValue: 'MEMBER',
      },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    })

    // ── connections (one per user) ─────────────────
    await queryInterface.createTable('connections', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.UUID, allowNull: false, unique: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      credentials: { type: DataTypes.JSONB, allowNull: true },
      status: {
        type: DataTypes.ENUM('DISCONNECTED', 'WAITING_QR', 'WAITING_PHONE_CODE', 'CONNECTED'),
        allowNull: false,
        defaultValue: 'DISCONNECTED',
      },
      phone_number: { type: DataTypes.STRING, allowNull: true },
      pairing_phone_number: { type: DataTypes.STRING, allowNull: true },
      qr_code: { type: DataTypes.TEXT, allowNull: true },
      qr_code_expires_at: { type: DataTypes.DATE, allowNull: true },
      last_connected_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    })

    // ── campaigns ──────────────────────────────────
    await queryInterface.createTable('campaigns', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      uuid: { type: DataTypes.UUID, allowNull: false, unique: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      name: { type: DataTypes.STRING, allowNull: false },
      offers: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      groups: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      safety: { type: DataTypes.JSONB, allowNull: false },
      status: {
        type: DataTypes.ENUM('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'),
        allowNull: false,
        defaultValue: 'DRAFT',
      },
      scheduled_at: { type: DataTypes.DATE, allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      total_sent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      total_failed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    })
    await queryInterface.addIndex('campaigns', ['user_id', 'status'])
    await queryInterface.addIndex('campaigns', ['status', 'scheduled_at'])

    // ── campaign_logs ──────────────────────────────
    await queryInterface.createTable('campaign_logs', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      campaign_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'campaigns', key: 'id' },
        onDelete: 'CASCADE',
      },
      group_id: { type: DataTypes.STRING, allowNull: false },
      group_name: { type: DataTypes.STRING, allowNull: false },
      offer_title: { type: DataTypes.STRING, allowNull: false },
      success: { type: DataTypes.BOOLEAN, allowNull: false },
      message_id: { type: DataTypes.STRING, allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      sent_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    })
    await queryInterface.addIndex('campaign_logs', ['campaign_id'])
  },

  async down(queryInterface) {
    await queryInterface.dropTable('campaign_logs')
    await queryInterface.dropTable('campaigns')
    await queryInterface.dropTable('connections')
    await queryInterface.dropTable('users')
    // Drop enum types created by Postgres for the ENUM columns
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_users_role", "enum_connections_status", "enum_campaigns_status" CASCADE;',
    )
  },
}
