'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize

    await queryInterface.createTable('group_messages', {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      connection_scope: { type: DataTypes.STRING(200), allowNull: false },
      group_id: { type: DataTypes.STRING(120), allowNull: false },
      group_name: { type: DataTypes.STRING, allowNull: true },
      direction: { type: DataTypes.ENUM('in', 'out'), allowNull: false },
      message_id: { type: DataTypes.STRING(200), allowNull: true },
      sender: { type: DataTypes.STRING(120), allowNull: true },
      sender_name: { type: DataTypes.STRING, allowNull: true },
      from_me: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      text: { type: DataTypes.TEXT, allowNull: true },
      media_type: { type: DataTypes.STRING(20), allowNull: true },
      media_url: { type: DataTypes.TEXT, allowNull: true },
      timestamp: { type: DataTypes.DATE, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    })

    // Thread read path: newest-first within a group of an instance.
    await queryInterface.addIndex('group_messages', ['connection_scope', 'group_id', 'timestamp'], {
      name: 'group_messages_scope_group_time_idx',
    })

    // Idempotent webhook ingestion: the same provider message id upserts.
    await queryInterface.addIndex('group_messages', ['connection_scope', 'message_id'], {
      name: 'group_messages_scope_message_unique',
      unique: true,
      where: { message_id: { [Sequelize.Op.ne]: null } },
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('group_messages')
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_group_messages_direction" CASCADE;',
    )
  },
}
